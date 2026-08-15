// The running order is one list and an item's state is where it has got to. Almost
// everything that can go wrong here is a version of confusing a promise with a
// fact: editing something a listener is about to hear, replaying a record that
// already aired, or losing one that was handed over and taken back before anybody
// heard it.

import { describe, expect, it } from 'vitest';

import {
    MAX_PLAYED_KEPT,
    StationLineup,
    type StationLineupBinding,
    type StationLineupItem,
    type StationLineupMode,
} from '../../../src/modules/director/station.lineup.js';
import type { RundownTrack } from '../../../src/modules/playout/rundown.js';

const track = (externalId: string): RundownTrack => ({
    pluginId: 'deadair.spotify',
    externalId,
    title: `Track ${externalId}`,
    artists: ['An Artist'],
});

const binding = (mode: StationLineupMode = 'rotation'): StationLineupBinding => ({
    name: 'Afternoons',
    mode,
    onEnd: 'extend',
    source: 'import',
});

const lineupWith = (ids: string[], mode: StationLineupMode = 'rotation'): StationLineup => {
    const lineup = new StationLineup(binding(mode));
    lineup.replaceFrom(ids.map(track));
    return lineup;
};

const idsOf = (items: readonly StationLineupItem[]) =>
    items.map(item => (item.kind === 'track' ? item.track.externalId : `segment:${item.segmentId}`));

const statesOf = (lineup: StationLineup) => lineup.all().map(item => item.state);

/** Hand the first `count` planned items over, the way a commit pass does. */
const hand = (lineup: StationLineup, count: number): StationLineupItem[] => {
    const items = lineup.nextPlanned(count);
    for (const item of items) lineup.markHanded(item.id);
    return items;
};

describe('StationLineup committing', () => {
    it('offers the planned items in order, and marking them is a separate step', () => {
        // `nextPlanned` is pure on purpose: the director has a segment to look up
        // between choosing an item and handing it over, and marking first means a
        // failure in the middle loses that programming for good.
        const lineup = lineupWith(['a', 'b', 'c']);

        expect(idsOf(lineup.nextPlanned(2))).toEqual(['a', 'b']);
        expect(statesOf(lineup)).toEqual(['planned', 'planned', 'planned']);

        hand(lineup, 2);
        expect(idsOf(lineup.nextPlanned(2))).toEqual(['c']);
    });

    it('runs out rather than wrapping, whatever the mode', () => {
        // Even a setlist. Wrapping is `resetPlayed`, decided at the end by whoever
        // reads `onEnd`, so what happened is a state on the items rather than index
        // arithmetic nobody can see afterwards.
        const lineup = lineupWith(['a', 'b'], 'setlist');
        hand(lineup, 5);

        expect(lineup.isExhausted()).toBe(true);
        expect(lineup.nextPlanned(1)).toEqual([]);
    });

    it('counts only what is still planned as remaining', () => {
        // The refill trigger. An item already with the player is spent, whether or
        // not the listener has reached it, so counting it would let the order run dry
        // while the station thought it had a lead in hand.
        const lineup = lineupWith(['a', 'b', 'c']);
        hand(lineup, 2);

        expect(lineup.remaining()).toBe(1);
    });

    it('takes nothing from an empty order rather than spinning', () => {
        expect(lineupWith([]).nextPlanned(3)).toEqual([]);
    });
});

describe('StationLineup and what the player has done', () => {
    it('marks everything committed before the airing item as skipped', () => {
        // A failed decode, an operator's skip and a push that never landed are the
        // same observation from here: the player has moved past them.
        const lineup = lineupWith(['a', 'b', 'c']);
        const [, second] = hand(lineup, 3);

        // The COUNT is the answer, because it is the only place the catch-up is visible: the
        // states below say what happened and nothing says how much of it there was.
        expect(lineup.markAiring(second!.id)).toEqual({ passedOver: 1 });
        expect(statesOf(lineup)).toEqual(['skipped', 'airing', 'handed']);
    });

    it('plays out what was airing when the next item starts', () => {
        // The one honest moment to say a record is behind us: a record is heard until
        // the next one begins.
        const lineup = lineupWith(['a', 'b']);
        const [first, second] = hand(lineup, 2);
        lineup.markAiring(first!.id);

        lineup.markAiring(second!.id);

        expect(statesOf(lineup)).toEqual(['played', 'airing']);
    });

    it('refuses an id it has never held rather than inventing it into the order', () => {
        // A reading from a session before this process started. There is nothing
        // truthful to say about it.
        const lineup = lineupWith(['a']);

        expect(lineup.markAiring('an-id-from-somewhere-else')).toBeUndefined();
        expect(statesOf(lineup)).toEqual(['planned']);
    });

    it('is idempotent about the item already airing', () => {
        // The notify and the reading both report it, a tick apart.
        const lineup = lineupWith(['a', 'b']);
        const [first] = hand(lineup, 2);
        lineup.markAiring(first!.id);

        // Nothing passed over the second time, or a repeated notify would report the same
        // catch-up twice.
        expect(lineup.markAiring(first!.id)).toEqual({ passedOver: 0 });
        expect(statesOf(lineup)).toEqual(['airing', 'handed']);
    });
});

describe('StationLineup reclaiming', () => {
    it('offers a retracted item again rather than losing it', () => {
        // Committing is a promise and airing is a fact. An item promised and never
        // heard has to come back, or it is programming the operator planned, paid for
        // and never heard, lost in silence. This was bug 4.
        const lineup = lineupWith(['a', 'b', 'c']);
        const handed = hand(lineup, 3);
        lineup.markAiring(handed[0]!.id);

        expect(lineup.reclaim(handed.map(item => item.id))).toBe(2);
        expect(statesOf(lineup)).toEqual(['airing', 'planned', 'planned']);
    });

    it('leaves what was airing alone, because it was heard', () => {
        // Offering it again would replay a record the listener is in the middle of,
        // which is the opposite mistake and just as audible.
        const lineup = lineupWith(['a', 'b']);
        const handed = hand(lineup, 2);
        lineup.markAiring(handed[0]!.id);
        lineup.markAiring(handed[1]!.id);

        lineup.reclaimAll();

        expect(statesOf(lineup)).toEqual(['played', 'airing']);
    });

    it('takes back everything the player holds when nothing is named', () => {
        const lineup = lineupWith(['a', 'b', 'c']);
        hand(lineup, 2);

        expect(lineup.reclaimAll()).toBe(2);
        expect(lineup.remaining()).toBe(3);
    });
});

describe('StationLineup editing', () => {
    it('refuses to move an item that has already been handed to the player', () => {
        // The operator is asking to reorder something a listener is about to hear.
        // Quietly doing something else instead is worse than saying no.
        const lineup = lineupWith(['a', 'b', 'c']);
        const [first] = hand(lineup, 1);

        const result = lineup.move(first!.id, 2);

        expect(result).toEqual({ ok: false, reason: 'already-aired', message: expect.any(String) });
        expect(idsOf(lineup.all())).toEqual(['a', 'b', 'c']);
    });

    it('refuses to move an item INTO the part the player is holding', () => {
        const lineup = lineupWith(['a', 'b', 'c']);
        hand(lineup, 1);

        expect(lineup.move(lineup.all()[2]!.id, 0)).toMatchObject({ ok: false, reason: 'already-aired' });
    });

    it('moves one that is still planned', () => {
        const lineup = lineupWith(['a', 'b', 'c']);

        expect(lineup.move(lineup.all()[2]!.id, 0)).toEqual({ ok: true });
        expect(idsOf(lineup.all())).toEqual(['c', 'a', 'b']);
    });

    it('refuses to remove an item that is already with the player', () => {
        const lineup = lineupWith(['a', 'b']);
        const [first] = hand(lineup, 1);

        expect(lineup.remove(first!.id)).toMatchObject({ ok: false, reason: 'already-aired' });
    });

    it('splices a record out, and leaves a removed break in the order marked as removed', () => {
        // The whole of the removed-break bug. `BreakPlanner` counts records since the
        // last segment ALREADY in the order, so a spliced-out break leaves a gap it
        // cannot tell from one that was never planted into, and it plants another.
        const lineup = lineupWith(['a', 'b', 'c']);
        lineup.insertSegment('talk', 2);

        // a, b, talk, c
        expect(lineup.remove(lineup.all()[1]!.id)).toEqual({ ok: true });
        expect(idsOf(lineup.all())).toEqual(['a', 'segment:talk', 'c']);

        expect(lineup.remove(lineup.all()[1]!.id)).toEqual({ ok: true });
        expect(idsOf(lineup.all())).toEqual(['a', 'segment:talk', 'c']);
        expect(statesOf(lineup)).toEqual(['planned', 'removed', 'planned']);
    });

    it('never offers a removed break to the player, and ages the mark out with the rest of the past', () => {
        const lineup = lineupWith(['a', 'b']);
        lineup.insertSegment('talk', 1);
        lineup.remove(lineup.all()[1]!.id);

        expect(idsOf(lineup.nextPlanned(3))).toEqual(['a', 'b']);
        expect(idsOf(lineup.upcoming())).toEqual(['a', 'b']);

        lineup.trimPast(0);
        expect(idsOf(lineup.all())).toEqual(['a', 'b']);
    });

    it('keeps a removed break out of the committed head, so the order in front of it stays editable', () => {
        // `removed` is the one non-planned state that says nothing about how far the
        // broadcast has got. Counting it would freeze everything in front of it: no move,
        // no insert, and nothing planted.
        const lineup = lineupWith(['a', 'b', 'c', 'd', 'e']);
        lineup.insertSegment('talk', 3);
        hand(lineup, 1);

        lineup.remove(lineup.all()[3]!.id);

        expect(lineup.committedThrough()).toBe(1);
        expect(lineup.move(lineup.all()[4]!.id, 1)).toEqual({ ok: true });
    });

    it('still counts a skipped item as part of the head, because the player reached it', () => {
        // The other half of the same distinction: passed over on the way here, rather than
        // cut before its turn came.
        const lineup = lineupWith(['a', 'b', 'c']);
        const handed = hand(lineup, 2);
        lineup.markSkipped(handed[1]!.id);

        expect(lineup.committedThrough()).toBe(2);
        expect(lineup.insertSegment('ident', 1)).toMatchObject({ ok: false, reason: 'already-aired' });
    });

    it('counts a record with no audio as part of the head, exactly like a skipped one', () => {
        // `unavailable` is a different FACT from `skipped` — an operator can act on it — and the
        // same position: the station reached the item and moved past it, so everything in front of
        // it has been committed.
        const lineup = lineupWith(['a', 'b', 'c']);
        const handed = hand(lineup, 2);

        expect(lineup.markUnavailable(handed[1]!.id)).toBe(true);
        expect(lineup.all()[1]?.state).toBe('unavailable');
        expect(lineup.committedThrough()).toBe(2);
    });

    it('marks a record unavailable from planned as well as from handed', () => {
        // Both, because the two callers reach it at different moments: the transport discovers it
        // resolving an item it has already claimed, and a benched copy is noticed while the line is
        // still only planned.
        const lineup = lineupWith(['a', 'b']);
        const [first] = hand(lineup, 1);

        expect(lineup.markUnavailable(first!.id)).toBe(true);
        expect(lineup.markUnavailable(lineup.all()[1]!.id)).toBe(true);
        expect(lineup.all().map(item => item.state)).toEqual(['unavailable', 'unavailable']);
    });

    it('is terminal: a record that could not be got hold of is not offered again', () => {
        // The same rule that makes `skipped` terminal. A state the director would retry is the
        // wait that skipping exists to avoid, by another name.
        const lineup = lineupWith(['a', 'b']);
        const [first] = hand(lineup, 1);
        lineup.markUnavailable(first!.id);

        expect(lineup.reclaimAll()).toBe(0);
        expect(lineup.all()[0]?.state).toBe('unavailable');
    });

    it('passes over an unavailable record when it says what plays next', () => {
        // What makes a break's forward claim fail rather than air: "coming up, X" is a promise
        // about the next record a listener will HEAR, and one the station cannot obtain is not it.
        const lineup = lineupWith(['a', 'b', 'c']);
        lineup.insertSegment('talk', 1);
        const breakLine = lineup.all()[1]!;
        const promised = lineup.all()[2]!;

        expect(lineup.nextTrackAfter(breakLine.id)?.id).toBe(promised.id);

        lineup.markUnavailable(promised.id);

        expect(lineup.nextTrackAfter(breakLine.id)?.id).toBe(lineup.all()[3]!.id);
    });

    it('ages an unavailable record out of the order like any other spent line', () => {
        const lineup = lineupWith(['a', 'b', 'c']);
        const [first] = hand(lineup, 1);
        lineup.markUnavailable(first!.id);

        lineup.trimPast(0);

        expect(idsOf(lineup.all())).toEqual(['b', 'c']);
    });

    it('says which refusal is which, because a console has to tell someone at the desk', () => {
        const lineup = lineupWith(['a']);

        expect(lineup.remove('no-such-item')).toMatchObject({ ok: false, reason: 'not-found' });
        expect(lineup.shuffleRemaining()).toMatchObject({ ok: false, reason: 'empty' });
        expect(lineup.insertSegments([])).toMatchObject({ ok: false, reason: 'empty' });
    });

    it('shuffles only the tail, and keeps the committed head in front and in order', () => {
        const lineup = lineupWith(['a', 'b', 'c', 'd']);
        hand(lineup, 2);

        expect(lineup.shuffleRemaining()).toEqual({ ok: true });
        expect(idsOf(lineup.all()).slice(0, 2)).toEqual(['a', 'b']);
        expect(idsOf(lineup.all()).slice(2).sort()).toEqual(['c', 'd']);
    });

    it('inserts segments from the highest index down, so every position still means what it meant', () => {
        // Front to back instead and the second placement lands one line late, the
        // third two, and a break planned for "after the fourth record" drifts further
        // the more of them there are.
        const lineup = lineupWith(['a', 'b', 'c', 'd']);

        expect(
            lineup.insertSegments([
                { segmentId: 'ident', atIndex: 1 },
                { segmentId: 'talk', atIndex: 3 },
            ]),
        ).toEqual({ ok: true });
        expect(idsOf(lineup.all())).toEqual(['a', 'segment:ident', 'b', 'c', 'segment:talk', 'd']);
    });

    it('keeps the segment kind on the item, so the spacing walk needs no query to tell breaks apart', () => {
        const lineup = lineupWith(['a', 'b', 'c']);

        expect(lineup.insertSegment('news', 1, undefined, 'news')).toEqual({ ok: true });
        expect(lineup.all()[1]).toMatchObject({ kind: 'segment', segmentId: 'news', segmentKind: 'news' });
    });

    it('leaves the kind absent when nobody said, which is how an order written before this reads', () => {
        // Not a default of `talkbreak` written in: absent is its own answer, and the walk is what
        // decides what an unlabelled break counts against. Writing a guess here would make an
        // order lie about what it holds.
        const lineup = lineupWith(['a', 'b']);
        lineup.insertSegment('old', 1);

        expect(lineup.all()[1]).not.toHaveProperty('segmentKind');
    });

    it('refuses a segment placed inside the part the player is holding', () => {
        const lineup = lineupWith(['a', 'b', 'c']);
        hand(lineup, 2);

        expect(lineup.insertSegment('ident', 1)).toMatchObject({ ok: false, reason: 'already-aired' });
    });

    it('keeps the head closed after a retraction hands items back mid-order', () => {
        // The case that makes "one past the last spent item" the right boundary and
        // "the first planned item" the wrong one. After a partial retraction the order
        // is played, planned, handed — and treating the first planned index as the
        // boundary would open editing onto an item the player is still holding.
        const lineup = lineupWith(['a', 'b', 'c']);
        const handed = hand(lineup, 3);
        lineup.markAiring(handed[0]!.id);
        lineup.reclaim([handed[1]!.id]);

        expect(statesOf(lineup)).toEqual(['airing', 'planned', 'handed']);
        expect(lineup.insertSegment('ident', 1)).toMatchObject({ ok: false, reason: 'already-aired' });
    });

    it('replaces the whole unplayed tail, and leaves everything the player has touched where it is', () => {
        // The difference between a replan and a shuffle: the records themselves change. What is
        // handed, airing or already spent is not the operator's to throw away.
        const lineup = lineupWith(['a', 'b', 'c', 'd']);
        const handed = hand(lineup, 2);
        lineup.markAiring(handed[0]!.id);

        lineup.replacePlanned([track('x'), track('y')]);

        expect(idsOf(lineup.all())).toEqual(['a', 'b', 'x', 'y']);
        expect(statesOf(lineup)).toEqual(['airing', 'handed', 'planned', 'planned']);
    });

    it('hands back the planned segments it dropped, which own rows that outlive the order', () => {
        // The caller needs these: a break the station was still writing is now describing a moment
        // that will never come round, and nothing else knows it was ever planned.
        const lineup = lineupWith(['a', 'b']);
        lineup.insertSegment('talk', 1);

        const dropped = lineup.replacePlanned([track('x')]);

        expect(idsOf(dropped)).toEqual(['a', 'segment:talk', 'b']);
        expect(idsOf(lineup.all())).toEqual(['x']);
    });

    it('keeps a removed break out of the way rather than reviving it, and leaves the past alone', () => {
        // `removed` and the spent states are facts about what happened, not plans. A replan is
        // about what is still to come.
        const lineup = lineupWith(['a', 'b', 'c']);
        const [first] = hand(lineup, 1);
        lineup.markAiring(first!.id);
        lineup.markPlayed(first!.id);
        lineup.insertSegment('ident', 1);
        lineup.remove(lineup.all()[1]!.id);

        lineup.replacePlanned([track('x')]);

        expect(idsOf(lineup.all())).toEqual(['a', 'segment:ident', 'x']);
        expect(statesOf(lineup)).toEqual(['played', 'removed', 'planned']);
    });

    it('takes a fresh tail onto an order that has run out, which is when it is wanted most', () => {
        const lineup = lineupWith([]);

        expect(lineup.replacePlanned([track('x')])).toEqual([]);
        expect(idsOf(lineup.all())).toEqual(['x']);
    });

    it('appends without disturbing anything already committed', () => {
        const lineup = lineupWith(['a']);
        hand(lineup, 1);

        expect(idsOf(lineup.append([track('b')]))).toEqual(['b']);
        expect(statesOf(lineup)).toEqual(['handed', 'planned']);
    });
});

describe('StationLineup at the end of the order', () => {
    it('offers everything again when it is told to repeat', () => {
        // What `on_end: 'repeat'` is now: a state put back rather than an index moved
        // to zero.
        const lineup = lineupWith(['a', 'b'], 'setlist');
        const handed = hand(lineup, 2);
        lineup.markAiring(handed[0]!.id);
        lineup.markAiring(handed[1]!.id);
        lineup.markPlayed(handed[1]!.id);

        expect(lineup.resetPlayed()).toBe(2);
        expect(lineup.remaining()).toBe(2);
    });

    it('trims the past down to what a console still shows', () => {
        // A rotation is appended to forever. The revision-guarded compaction that used
        // to do this is gone with the revision, but the need is not, and a document
        // that grows without limit is the same bug wearing a different hat.
        const lineup = lineupWith(Array.from({ length: MAX_PLAYED_KEPT + 5 }, (_, index) => `t${index}`));
        for (const item of hand(lineup, MAX_PLAYED_KEPT + 3)) lineup.markAiring(item.id);

        expect(lineup.trimPast()).toBe(2);
        expect(lineup.size()).toBe(MAX_PLAYED_KEPT + 3);
        // Never the airing item or anything still to come.
        expect(lineup.all().filter(item => item.state === 'airing')).toHaveLength(1);
        expect(lineup.remaining()).toBe(2);
    });

    it('never trims a setlist, whose past is what it is about to replay', () => {
        const lineup = lineupWith(
            Array.from({ length: MAX_PLAYED_KEPT + 5 }, (_, index) => `t${index}`),
            'setlist',
        );
        for (const item of hand(lineup, MAX_PLAYED_KEPT + 3)) lineup.markAiring(item.id);

        expect(lineup.trimPast()).toBe(0);
        expect(lineup.size()).toBe(MAX_PLAYED_KEPT + 5);
    });
});

describe('StationLineup snapshots', () => {
    it('carries the items and the binding, and nothing derived', () => {
        // There is no cursor and no revision to write. The position is where the
        // items say they have got to, which is the whole point of the shape.
        const lineup = new StationLineup({ ...binding(), sourcePluginId: 'deadair.spotify', sourcePlaylistId: 'p1' });
        lineup.replaceFrom([track('a')]);
        hand(lineup, 1);

        expect(lineup.toSnapshot()).toEqual({
            // Minted by the constructor: a running order and the broadcast it is are one thing.
            broadcastId: expect.any(String),
            name: 'Afternoons',
            mode: 'rotation',
            onEnd: 'extend',
            source: 'import',
            sourcePluginId: 'deadair.spotify',
            sourcePlaylistId: 'p1',
            items: [{ id: expect.any(String), kind: 'track', state: 'handed', track: track('a') }],
        });
    });
});
