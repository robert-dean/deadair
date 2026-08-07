// A lineup is the plan; the rundown is the few items the player is holding. The
// cursor is the line between them, and almost everything that can go wrong here
// is a version of forgetting that: editing something a listener is about to
// hear, replaying what already aired, or compacting away a setlist that was
// about to play again.

import { describe, expect, it, vi } from 'vitest';

import { Lineup, type LineupMode, type LineupStore } from '../../../src/modules/director/lineup.js';
import type { RundownTrack } from '../../../src/modules/playout/rundown.js';

const track = (externalId: string): RundownTrack => ({
    pluginId: 'deadair.spotify',
    externalId,
    title: `Track ${externalId}`,
    artists: ['An Artist'],
});

const build = (ids: string[], mode: LineupMode = 'rotation') => {
    const lineup = new Lineup({ id: 'lineup-1', name: 'Afternoons', mode, onEnd: 'extend', source: 'import' });
    return { lineup, seed: () => lineup.replace(ids.map(track)) };
};

const lineupWith = async (ids: string[], mode: LineupMode = 'rotation'): Promise<Lineup> => {
    const { lineup, seed } = build(ids, mode);
    await seed();
    return lineup;
};

const idsOf = (items: readonly { track: RundownTrack }[]) => items.map(item => item.track.externalId);

describe('Lineup committing', () => {
    it('hands over from the cursor, in order', async () => {
        const lineup = await lineupWith(['a', 'b', 'c']);

        expect(idsOf(await lineup.takeNext(2))).toEqual(['a', 'b']);
        expect(lineup.cursor()).toBe(2);
        expect(idsOf(lineup.upcoming())).toEqual(['c']);
    });

    it('runs out rather than wrapping, for anything that is not a setlist', async () => {
        // A rotation that wrapped would replay itself instead of being extended,
        // and a feature that wrapped would play the album twice.
        const lineup = await lineupWith(['a', 'b']);

        expect((await lineup.takeNext(5)).length).toBe(2);
        expect(lineup.isExhausted()).toBe(true);
        expect(await lineup.takeNext(1)).toEqual([]);
    });

    it('wraps a setlist to the top, which is what makes it play across a month', async () => {
        const lineup = await lineupWith(['a', 'b'], 'setlist');

        expect(idsOf(await lineup.takeNext(5))).toEqual(['a', 'b', 'a', 'b', 'a']);
    });

    it('takes nothing from an empty lineup rather than spinning', async () => {
        const lineup = await lineupWith([], 'setlist');

        expect(await lineup.takeNext(3)).toEqual([]);
    });

    it('leaves the revision alone when it commits', async () => {
        // Committing is not a change to the PLAN. Bumping here would invalidate a
        // console's in-flight edit every couple of minutes for no reason.
        const lineup = await lineupWith(['a', 'b']);
        const before = lineup.revision();

        await lineup.takeNext(1);

        expect(lineup.revision()).toBe(before);
    });
});

describe('Lineup editing', () => {
    it('refuses to move a line that has already been handed to the player', async () => {
        // The operator is asking to reorder something a listener is about to hear.
        // Quietly doing something else instead is worse than saying no.
        const lineup = await lineupWith(['a', 'b', 'c']);
        await lineup.takeNext(1);

        const result = await lineup.remove(lineup.all()[0]!.id);

        expect(result).toEqual({ ok: false, reason: 'already-aired', message: expect.any(String) });
    });

    it('refuses to move a line INTO the committed part', async () => {
        const lineup = await lineupWith(['a', 'b', 'c']);
        await lineup.takeNext(1);

        expect((await lineup.move(lineup.all()[2]!.id, 0)).ok).toBe(false);
    });

    it('moves a line that is still in the plan', async () => {
        const lineup = await lineupWith(['a', 'b', 'c']);

        expect((await lineup.move(lineup.all()[2]!.id, 0)).ok).toBe(true);
        expect(idsOf(lineup.all())).toEqual(['c', 'a', 'b']);
    });

    it('refuses an edit made against a lineup that has since changed', async () => {
        // The console drew a list and the operator acted on what they could see. If
        // the director appended in between, that view no longer means what it meant.
        const lineup = await lineupWith(['a', 'b']);
        const staleRevision = lineup.revision();
        await lineup.append([track('c')]);

        const result = await lineup.remove(lineup.all()[1]!.id, staleRevision);

        expect(result).toEqual({ ok: false, reason: 'stale-revision', message: expect.any(String) });
        expect(lineup.size()).toBe(3);
    });

    it('lets a caller with no view of the order skip the check', async () => {
        // The director's own writes are not racing anyone.
        const lineup = await lineupWith(['a', 'b']);

        expect((await lineup.remove(lineup.all()[1]!.id)).ok).toBe(true);
    });

    it('says a line it does not hold is not there, rather than failing at it', async () => {
        const lineup = await lineupWith(['a']);

        expect(await lineup.remove('nope')).toEqual({ ok: false, reason: 'not-found', message: expect.any(String) });
    });

    it('shuffles only what has not been committed', async () => {
        const lineup = await lineupWith(['a', 'b', 'c', 'd', 'e']);
        await lineup.takeNext(2);

        expect((await lineup.shuffleRemaining()).ok).toBe(true);

        expect(idsOf(lineup.all()).slice(0, 2)).toEqual(['a', 'b']);
        expect(idsOf(lineup.all()).slice(2).sort()).toEqual(['c', 'd', 'e']);
    });

    it('refuses a shuffle that could not change anything', async () => {
        const lineup = await lineupWith(['a', 'b']);
        await lineup.takeNext(2);

        expect(await lineup.shuffleRemaining()).toEqual({ ok: false, reason: 'empty', message: expect.any(String) });
    });

    it('starts again from the top when the whole order is replaced', async () => {
        // The items the cursor counted are gone; leaving it where it was would skip
        // the head of the new list.
        const lineup = await lineupWith(['a', 'b', 'c']);
        await lineup.takeNext(2);

        await lineup.replace([track('x'), track('y')]);

        expect(lineup.cursor()).toBe(0);
        expect(idsOf(lineup.upcoming())).toEqual(['x', 'y']);
    });

    it('leaves the cursor alone on an append, because the plan is continuing', async () => {
        const lineup = await lineupWith(['a', 'b']);
        await lineup.takeNext(2);

        await lineup.append([track('c')]);

        expect(lineup.cursor()).toBe(2);
        expect(idsOf(lineup.upcoming())).toEqual(['c']);
    });

    it('bumps the revision on every change to the order', async () => {
        const lineup = await lineupWith(['a', 'b']);
        const start = lineup.revision();

        await lineup.append([track('c')]);
        await lineup.move(lineup.all()[2]!.id, 0);

        expect(lineup.revision()).toBe(start + 2);
    });
});

describe('Lineup durability', () => {
    const storeSpy = () => {
        const store: LineupStore & { saveItems: ReturnType<typeof vi.fn>; saveCursor: ReturnType<typeof vi.fn> } = {
            saveItems: vi.fn(async () => {}),
            saveCursor: vi.fn(async () => {}),
        };
        return store;
    };

    it('saves the order and the cursor separately', async () => {
        // They move at completely different rates and live in different tables: one
        // combined save would rewrite a several-hundred-line document for one integer.
        const store = storeSpy();
        const lineup = await lineupWith(['a', 'b', 'c']);
        lineup.bindStore(store);

        await lineup.takeNext(1);
        expect(store.saveCursor).toHaveBeenCalledWith('lineup-1', 1);
        expect(store.saveItems).not.toHaveBeenCalled();

        await lineup.append([track('d')]);
        expect(store.saveItems).toHaveBeenCalledOnce();
    });

    it('works with no store at all, which is what makes it testable', async () => {
        const lineup = await lineupWith(['a']);

        await expect(lineup.takeNext(1)).resolves.toHaveLength(1);
    });

    it('restores the cursor it was loaded with', async () => {
        const lineup = new Lineup(
            { id: 'lineup-1', name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' },
            [{ id: 'i1', track: track('a') }, { id: 'i2', track: track('b') }],
            4,
            1,
        );

        expect(lineup.cursor()).toBe(1);
        expect(idsOf(lineup.upcoming())).toEqual(['b']);
    });

    it('clamps a cursor that outran the order it was stored against', async () => {
        // A hand-edited row, or a lineup shortened while off air. Believing it would
        // report a lineup as exhausted that still has items in it.
        const lineup = new Lineup(
            { id: 'lineup-1', name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' },
            [{ id: 'i1', track: track('a') }],
            0,
            99,
        );

        expect(lineup.cursor()).toBe(1);
    });
});

describe('Lineup compaction', () => {
    it('drops the played prefix once enough has built up', async () => {
        // A rotation is appended to forever; without this a station left running for
        // a week carries thousands of dead lines in one document.
        const lineup = await lineupWith(Array.from({ length: 40 }, (_, index) => `t${index}`));

        await lineup.takeNext(35);

        expect(lineup.size()).toBe(5);
        expect(lineup.cursor()).toBe(0);
        expect(idsOf(lineup.upcoming())).toEqual(['t35', 't36', 't37', 't38', 't39']);
    });

    it('never compacts a setlist, which is about to play those lines again', async () => {
        const lineup = await lineupWith(
            Array.from({ length: 40 }, (_, index) => `t${index}`),
            'setlist',
        );

        await lineup.takeNext(35);

        expect(lineup.size()).toBe(40);
        expect(lineup.cursor()).toBe(35);
    });

    it('does not bump the revision, because nothing about the plan changed', async () => {
        // Bumping would refuse a console's in-flight edit for a housekeeping detail.
        const lineup = await lineupWith(Array.from({ length: 40 }, (_, index) => `t${index}`));
        const before = lineup.revision();

        await lineup.takeNext(35);

        expect(lineup.revision()).toBe(before);
    });
});
