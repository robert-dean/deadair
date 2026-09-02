// The rundown exists to keep one distinction straight: handing an item to the
// player is not the same as it airing. Liquidsoap downloads the next request while
// the previous one is still playing, so an app that conflates the two is a full
// item ahead of the listener — wrong for now-playing, for history, and for anything
// that ever times a break.
//
// So these tests are mostly about the recovery paths, because those are the ones a
// running station exercises and nobody watches: a dropped push, a notify that never
// arrived, a Liquidsoap that restarted and forgot everything it was handed.
//
// The rundown no longer holds a list. There is ONE ordered list — the director's
// `StationLineup` — and an item's state on it is where it has got to, so these cases
// drive the real one rather than a fake: what is being tested is precisely what the
// two do together.

import { describe, expect, it, vi } from 'vitest';

import { Rundown, type RundownItem, type RundownTrack } from '../../../src/modules/playout/rundown.js';
import { StationLineup, isTrackItem } from '../../../src/modules/director/station.lineup.js';
import { TrackResolver } from '../../../src/modules/playout/playout.capability.js';
import type { Logger } from '@maroonedsoftware/logger';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

/** Resolves everything to a fake URL, except ids listed as unresolvable. */
class StubResolver extends TrackResolver {
    constructor(private readonly unresolvable = new Set<string>()) {
        super();
    }
    async resolve(item: { externalId: string }): Promise<string | undefined> {
        return this.unresolvable.has(item.externalId) ? undefined : `https://example.test/${item.externalId}.ogg`;
    }
}

const track = (externalId: string): RundownTrack => ({
    pluginId: 'deadair.spotify',
    externalId,
    title: `Track ${externalId}`,
    artists: ['An Artist'],
    artist: 'An Artist',
    durationMs: 200_000,
});

/**
 * Prepare items for the player: the director's half, which here is a straight copy.
 *
 * A record already carries everything the player needs. A segment would need its row read, which is
 * exactly why preparing is the director's job and not the transport's.
 */
const prepareAll = (rundown: Rundown, order: StationLineup): void => {
    rundown.prepare(order.all().flatMap(item => (isTrackItem(item) ? [{ ...item.track, id: item.id } as RundownItem] : [])));
};

/** A transport over a running order, attached and prepared, the way the director leaves it. */
const rundownWith = (ids: string[], resolver: TrackResolver = new StubResolver()): Rundown => {
    const rundown = new Rundown(resolver, logger);
    orderOf(rundown, ids);
    return rundown;
};

/** The same over tracks a case has built itself, for the ones that need a cue attached. */
const seedWith = (rundown: Rundown, tracks: readonly RundownTrack[]): StationLineup => {
    const order = new StationLineup({ name: 'Test', mode: 'rotation', onEnd: 'extend', source: 'import' });
    order.replaceFrom(tracks);
    rundown.attach(order);
    prepareAll(rundown, order);
    return order;
};

/** The same, handing the order back for a case that asserts on its states. */
const orderOf = (rundown: Rundown, ids: string[]): StationLineup => {
    const order = new StationLineup({ name: 'Test', mode: 'rotation', onEnd: 'extend', source: 'import' });
    order.replaceFrom(ids.map(track));
    rundown.attach(order);
    prepareAll(rundown, order);
    return order;
};

describe('Rundown hand-over', () => {
    it('hands items over in order and takes them out of the queue', async () => {
        const rundown = rundownWith(['a', 'b']);

        const first = await rundown.next();
        expect(first?.item.externalId).toBe('a');
        expect(first?.url).toBe('https://example.test/a.ogg');
        expect(rundown.queuedCount()).toBe(1);
    });

    it('still counts a handed-over item as coming, and puts it first', async () => {
        // Handing an item to the player does not make it airing — it makes it NEXT.
        // A console told only about the queue names the track after next as next,
        // because the real next one is the one already downloading.
        const rundown = rundownWith(['a', 'b', 'c']);
        const pulled = await rundown.next();
        rundown.markAired(pulled!.item.id);
        await rundown.next();

        expect(rundown.upcoming().map(entry => entry.externalId)).toEqual(['b', 'c']);
        expect(rundown.queuedCount()).toBe(1);
    });

    it("carries the running order's own id rather than the provider id", async () => {
        // The id rides through Liquidsoap on the annotation and comes back on the
        // notify; a provider id would collide the moment a playlist repeats a track.
        // It is the ORDER's id, which is what makes it survive a restart: the row
        // holds it, so an app that comes back can name what the player is airing.
        const rundown = rundownWith(['a', 'a']);

        const first = await rundown.next();
        const second = await rundown.next();
        expect(first!.item.id).not.toBe(second!.item.id);
    });

    it('skips an item nothing can resolve rather than stalling on it', async () => {
        // One track whose plugin is disabled must not become dead air.
        const rundown = rundownWith(['a', 'b'], new StubResolver(new Set(['a'])));

        expect((await rundown.next())?.item.externalId).toBe('b');
    });

    it('calls a record it cannot resolve unavailable, not skipped', async () => {
        // The one terminal state an operator can act on: nothing here was a decision the station
        // made, it is a copy that would not serve. Folding it into `skipped` leaves it looking like
        // a break that missed its slot.
        const order = new StationLineup({ name: 'Test', mode: 'rotation', onEnd: 'extend', source: 'import' });
        order.replaceFrom(['a', 'b'].map(track));
        const rundown = new Rundown(new StubResolver(new Set(['a'])), logger);
        rundown.attach(order);
        prepareAll(rundown, order);

        await rundown.next();

        expect(order.all()[0]?.state).toBe('unavailable');
    });

    it('runs out rather than repeating itself', async () => {
        const rundown = rundownWith(['a']);
        await rundown.next();

        expect(await rundown.next()).toBeUndefined();
    });

    it('puts an unserved item back at the head of the queue', async () => {
        // A push that did not land: nothing aired, so the next pass has to offer the
        // same item again rather than skip it.
        const rundown = rundownWith(['a', 'b']);
        const pulled = await rundown.next();

        expect(rundown.unserve(pulled!.item.id)).toBe(true);
        expect((await rundown.next())?.item.externalId).toBe('a');
    });
});

describe('Rundown airing', () => {
    it('reports nothing on air until the player says so', async () => {
        const rundown = rundownWith(['a']);
        await rundown.next();

        // Handed over and downloading; the listener is still hearing whatever came before.
        expect(rundown.nowPlaying()).toBeUndefined();
    });

    it('puts an item on air when the notify names it', async () => {
        const rundown = rundownWith(['a']);
        const pulled = await rundown.next();

        expect(rundown.markAired(pulled!.item.id)).toBe(true);
        expect(rundown.nowPlaying()?.item.externalId).toBe('a');
    });

    it('drops items skipped over when a later one is named', async () => {
        // An operator skip or a failed decode means the player moved past an item
        // without ever airing it; it must not stay pending forever.
        const rundown = rundownWith(['a', 'b']);
        await rundown.next();
        const second = await rundown.next();

        rundown.markAired(second!.item.id);

        expect(rundown.nowPlaying()?.item.externalId).toBe('b');
        // Nothing is left pending, so a reading of an empty player re-queues nothing.
        rundown.reconcile({ queued: 0, ready: true, onAir: second!.item.id });
        expect(rundown.queuedCount()).toBe(0);
    });

    it('ignores a notify for an item it never handed over', async () => {
        const rundown = rundownWith(['a']);

        expect(rundown.markAired('an-id-from-a-previous-process')).toBe(false);
        expect(rundown.nowPlaying()).toBeUndefined();
    });
});

describe('Rundown.reconcile', () => {
    it('believes nothing from a reading with no `ready` field', async () => {
        // That field only exists in the radio.liq that reports the rest of the reading,
        // so its absence means the container is on an older script.
        const rundown = rundownWith(['a', 'b']);
        const pulled = await rundown.next();
        rundown.markAired(pulled!.item.id);

        rundown.reconcile({ queued: 0 });

        expect(rundown.nowPlaying()?.item.externalId).toBe('a');
    });

    it('takes the item off air when the player stops producing', async () => {
        // The only positive "it ended" signal there is: a boundary only ever says a
        // new item started, so an order that runs out otherwise stays on air forever.
        const rundown = rundownWith(['a']);
        const pulled = await rundown.next();
        rundown.markAired(pulled!.item.id);

        rundown.reconcile({ queued: 0, ready: false });

        expect(rundown.nowPlaying()).toBeUndefined();
    });

    it('adopts an item the notify never reported', async () => {
        // A dropped notify: the reading is the recovery path.
        const rundown = rundownWith(['a']);
        const pulled = await rundown.next();

        rundown.reconcile({ queued: 0, ready: true, onAir: pulled!.item.id });

        expect(rundown.nowPlaying()?.item.externalId).toBe('a');
    });

    it('stands the clock down when the player names an item this process never served', async () => {
        // A Liquidsoap that outlived an app restart. Going on announcing the old item
        // would be a claim the player has just disproved.
        const rundown = rundownWith(['a']);
        const pulled = await rundown.next();
        rundown.markAired(pulled!.item.id);

        rundown.reconcile({ queued: 0, ready: true, onAir: 'from-a-previous-session' });

        expect(rundown.nowPlaying()).toBeUndefined();
    });

    it('re-queues items the player turns out not to be holding', async () => {
        // A push that was accepted but lost, or a Liquidsoap restart. Left alone these
        // items are believed delivered and the running order silently skips them.
        vi.useFakeTimers();
        try {
            const rundown = rundownWith(['a', 'b', 'c']);
            await rundown.next();
            await rundown.next();
            expect(rundown.queuedCount()).toBe(1);

            // Long enough that the player cannot still be fetching them.
            vi.advanceTimersByTime(30_000);
            rundown.reconcile({ queued: 0, ready: false });

            expect(rundown.queuedCount()).toBe(3);
            expect((await rundown.next())?.item.externalId).toBe('a');
        } finally {
            vi.useRealTimers();
        }
    });

    it('gives up on an item the player never takes, rather than offering it forever', async () => {
        // The loop that turned a Spotify outage into a station that cycled silently for
        // a day. An item whose URL resolves fine and then fails when the player pulls it
        // never reaches `next`'s skip check, so without a ceiling it is lost, reclaimed,
        // offered again, and lost again, and the running order never advances past it.
        vi.useFakeTimers();
        try {
            const rundown = rundownWith(['a', 'b']);
            const order = orderOf(rundown, ['a', 'b']);

            for (let attempt = 0; attempt < 3; attempt++) {
                const pulled = await rundown.next();
                expect(pulled?.item.externalId).toBe('a');
                vi.advanceTimersByTime(30_000);
                rundown.reconcile({ queued: 0, ready: false });
            }

            expect(order.all().find(item => item.id === order.all()[0]!.id)?.state).toBe('skipped');
            // And the order has moved on, which is the point: the next thing offered is
            // the item behind it rather than the same one a fourth time.
            expect((await rundown.next())?.item.externalId).toBe('b');
        } finally {
            vi.useRealTimers();
        }
    });

    it('still retries twice first, because a lost push is the common recoverable case', async () => {
        // A player that restarted drops everything it was holding at once, and those
        // items genuinely should be given back. A ceiling of one would skip real
        // programming over a single dropped push.
        vi.useFakeTimers();
        try {
            const rundown = rundownWith(['a', 'b']);
            const order = orderOf(rundown, ['a', 'b']);

            for (let attempt = 0; attempt < 2; attempt++) {
                await rundown.next();
                vi.advanceTimersByTime(30_000);
                rundown.reconcile({ queued: 0, ready: false });
            }

            expect(order.all().every(item => item.state === 'planned')).toBe(true);
            expect((await rundown.next())?.item.externalId).toBe('a');
        } finally {
            vi.useRealTimers();
        }
    });

    it('carries attempts across a change of programming', async () => {
        // A retract is not evidence that a track which could not be fetched a minute ago
        // can be fetched now, so the count has to survive one — otherwise a station that
        // replans often never reaches the ceiling at all.
        vi.useFakeTimers();
        try {
            const rundown = rundownWith(['a']);
            const order = orderOf(rundown, ['a']);

            for (let attempt = 0; attempt < 2; attempt++) {
                await rundown.next();
                vi.advanceTimersByTime(30_000);
                rundown.reconcile({ queued: 0, ready: false });
            }

            rundown.retract();
            // The director's half after a retraction: the order is unchanged, and it
            // hands the playable forms back.
            prepareAll(rundown, order);

            await rundown.next();
            vi.advanceTimersByTime(30_000);
            rundown.reconcile({ queued: 0, ready: false });

            expect(order.all()[0]!.state).toBe('skipped');
        } finally {
            vi.useRealTimers();
        }
    });

    it('gives an item fresh attempts after a stand-down', async () => {
        // A stand-down is an operator intervening, and the usual thing they intervene by
        // doing is fixing whatever was refusing. The SAME order is re-prepared here, so
        // the ids are the ones that already spent attempts — a fresh order would mint
        // new ids and prove nothing.
        vi.useFakeTimers();
        try {
            const rundown = rundownWith(['a']);
            const order = orderOf(rundown, ['a']);

            for (let attempt = 0; attempt < 2; attempt++) {
                await rundown.next();
                vi.advanceTimersByTime(30_000);
                rundown.reconcile({ queued: 0, ready: false });
            }

            rundown.reset();
            prepareAll(rundown, order);

            await rundown.next();
            vi.advanceTimersByTime(30_000);
            rundown.reconcile({ queued: 0, ready: false });

            // Reclaimed rather than skipped: this is attempt one of three again.
            expect(order.all()[0]!.state).toBe('planned');
        } finally {
            vi.useRealTimers();
        }
    });

    it('leaves a just-handed-over item alone, because the player is still fetching it', async () => {
        // The bug this exists for: Liquidsoap takes a pushed request OFF the queue to
        // resolve it, so for the seconds it spends downloading a track the item is in
        // neither `queued` nor `onAir`. Reading that as a lost push hands the same item
        // over twice, and the listener hears the track twice.
        vi.useFakeTimers();
        try {
            const rundown = rundownWith(['a', 'b']);
            await rundown.next();
            expect(rundown.queuedCount()).toBe(1);

            // The reading the player gives while it is fetching: holding nothing,
            // producing nothing, naming nothing.
            vi.advanceTimersByTime(2_000);
            rundown.reconcile({ queued: 0, ready: false });

            // Still handed over, NOT back in the queue to be pushed a second time.
            expect(rundown.queuedCount()).toBe(1);
            expect(rundown.upcoming().map(entry => entry.externalId)).toEqual(['a', 'b']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('leaves an item this process is still resolving alone, even when a reading lands mid-resolve', async () => {
        // The other half of the grace. A hand-over marks the item `handed` and then awaits the
        // resolve, and an operator's skip takes a reading every 100ms while it waits for the
        // boundary. For as long as the stamp was written AFTER the resolve, a reading in that window
        // found a handed item with no stamp, called it lost, and reclaimed it: this pass then handed
        // it over anyway, the next pass handed it over again, and the listener heard it twice.
        let release: (url: string) => void = () => {};
        const resolver = {
            resolve: () => new Promise<string>(resolve => (release = resolve)),
        } as unknown as TrackResolver;
        const rundown = rundownWith(['a', 'b'], resolver);

        const handing = rundown.next();
        // Let `next()` reach its await.
        await Promise.resolve();
        expect(rundown.queuedCount()).toBe(1);

        // The skip's reading: the player holds nothing, because nothing has been pushed yet.
        rundown.reconcile({ queued: 0, ready: true, onAir: 'something-else' });

        release('https://example.test/a.ogg');
        const pulled = await handing;

        expect(pulled?.item.externalId).toBe('a');
        // Still handed over, exactly once: not reclaimed, so the next pass offers `b` and not `a` again.
        expect(rundown.queuedCount()).toBe(1);
        expect(rundown.upcoming().map(entry => entry.externalId)).toEqual(['a', 'b']);
    });

    it('leaves the running order alone when the player holds what it was given', async () => {
        const rundown = rundownWith(['a', 'b']);
        const pulled = await rundown.next();
        rundown.markAired(pulled!.item.id);
        await rundown.next();

        // One on air, one queued behind it: exactly what was handed over.
        rundown.reconcile({ queued: 1, ready: true, onAir: pulled!.item.id });

        expect(rundown.queuedCount()).toBe(0);
        expect(rundown.nowPlaying()?.item.externalId).toBe('a');
    });

    it('projects the playhead forward from the last measurement', async () => {
        vi.useFakeTimers();
        try {
            const rundown = rundownWith(['a']);
            const pulled = await rundown.next();
            rundown.markAired(pulled!.item.id);
            rundown.reconcile({ queued: 0, ready: true, onAir: pulled!.item.id, remainingMs: 10_000 });

            vi.advanceTimersByTime(3_000);

            expect(rundown.nowPlaying()?.remainingMs).toBe(7_000);
        } finally {
            vi.useRealTimers();
        }
    });

    it('never projects the playhead past the end of the item', async () => {
        vi.useFakeTimers();
        try {
            const rundown = rundownWith(['a']);
            const pulled = await rundown.next();
            rundown.markAired(pulled!.item.id);
            rundown.reconcile({ queued: 0, ready: true, onAir: pulled!.item.id, remainingMs: 1_000 });

            vi.advanceTimersByTime(60_000);

            expect(rundown.nowPlaying()?.remainingMs).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('Rundown.retract and reset', () => {
    it('announces a reset so the transport can take back what has not aired', async () => {
        const rundown = rundownWith(['a']);
        const onReset = vi.fn();
        rundown.onReset(onReset);

        rundown.retract();

        expect(onReset).toHaveBeenCalledOnce();
    });

    it('offers a retracted item again rather than losing it', async () => {
        // The item was promised and never heard, so it goes back to `planned` on the one
        // order. It used to be dropped from a second list and left behind a cursor that had
        // already counted it, which is programming nobody hears.
        const rundown = new Rundown(new StubResolver(), logger);
        const order = orderOf(rundown, ['a']);
        const pulled = await rundown.next();
        expect(order.all()[0]!!.state).toBe('handed');

        rundown.retract();

        expect(order.all()[0]!!.state).toBe('planned');
        expect(pulled!.item.id).toBe(order.all()[0]!!.id);
    });

    it('does not take a retracted item as a fault when the player still names it', async () => {
        // Liquidsoap skips in its streaming loop rather than in the request that asked for it,
        // so the very next reading can still name something the station has just given up on.
        // It is ours, it is simply not ours to play any more.
        const rundown = rundownWith(['a']);
        const pulled = await rundown.next();
        rundown.retract();
        vi.mocked(logger.warn).mockClear();

        rundown.reconcile({ queued: 0, ready: true, onAir: pulled!.item.id });

        expect(logger.warn).not.toHaveBeenCalled();
        expect(rundown.nowPlaying()).toBeUndefined();
    });

    it('leaves what is on air alone: a new order is not a reason to cut the listener off', async () => {
        const rundown = rundownWith(['a']);
        const pulled = await rundown.next();
        rundown.markAired(pulled!.item.id);

        rundown.retract();

        expect(rundown.nowPlaying()?.item.externalId).toBe('a');
    });

    it('empties the running order on reset', async () => {
        const rundown = rundownWith(['a', 'b']);

        rundown.reset();

        expect(rundown.queuedCount()).toBe(0);
        expect(await rundown.next()).toBeUndefined();
    });

    it('takes what is on air down with it, so the station stops rather than plays out', async () => {
        // deadair holds the mount only while it has a programme. Leaving the airing
        // item behind would have a stood-down station still asserting control of a
        // track it just abandoned, and the audio would outlive the command.
        const rundown = rundownWith(['a', 'b']);
        const pulled = await rundown.next();
        rundown.markAired(pulled!.item.id);
        expect(rundown.hasProgramme()).toBe(true);

        rundown.reset();

        expect(rundown.nowPlaying()).toBeUndefined();
        expect(rundown.hasProgramme()).toBe(false);
    });

    it('still has a programme while an item it handed over has not aired yet', async () => {
        // Handed over but not airing is the gap the lease must not fall into: the app
        // has committed to that item and the player is fetching it.
        const rundown = rundownWith(['a']);
        await rundown.next();

        expect(rundown.nowPlaying()).toBeUndefined();
        expect(rundown.hasProgramme()).toBe(true);
    });

    it('does not report the item it just stood down on as an id from another session', async () => {
        // Stop drops what is on air here, but Liquidsoap skips in its streaming loop
        // rather than in the request that asked for it, so the very next reading can
        // still name that item. Treating that as an unexplainable id prints a
        // diagnostic for a foreign Liquidsoap every single time an operator presses
        // Stop, which sends them looking for a fault that did not happen.
        const rundown = rundownWith(['a']);
        const pulled = await rundown.next();
        rundown.markAired(pulled!.item.id);
        rundown.reset();
        vi.mocked(logger.warn).mockClear();

        rundown.reconcile({ queued: 0, ready: true, onAir: pulled!.item.id });

        expect(logger.warn).not.toHaveBeenCalled();
        // Still stood down: it is nobody's running order now, it is just not a fault.
        expect(rundown.nowPlaying()).toBeUndefined();
        expect(rundown.hasProgramme()).toBe(false);
    });

    it('still reports an id from a session before this process started', async () => {
        // The suppression above is scoped to ids this process handed over, so the
        // case it exists for — a Liquidsoap that outlived an app restart — is still
        // reported.
        const rundown = rundownWith(['a']);
        const pulled = await rundown.next();
        rundown.markAired(pulled!.item.id);
        rundown.reset();
        vi.mocked(logger.warn).mockClear();

        rundown.reconcile({ queued: 0, ready: true, onAir: 'from-a-previous-session' });

        expect(logger.warn).toHaveBeenCalledOnce();
    });

    it('tells a replacement from a stand-down, because only one of them cuts the listener off', async () => {
        const rundown = rundownWith(['a']);
        const announced: boolean[] = [];
        rundown.onReset(standingDown => announced.push(standingDown));

        rundown.retract();
        rundown.reset();

        expect(announced).toEqual([false, true]);
    });
});

// Preparing is the director telling the transport HOW to play what the order already says. It
// changes nothing about the order, which is what makes it safe to do on every pass.
describe('Rundown.prepare', () => {
    it('does not disturb what the player already holds', async () => {
        // A top-up must not retract items the player has already downloaded and hand them
        // back. Under one list it cannot: preparing touches no state at all.
        const rundown = new Rundown(new StubResolver(), logger);
        const order = orderOf(rundown, ['a', 'b']);
        const pulled = await rundown.next();
        rundown.markAired(pulled!.item.id);
        const served = await rundown.next();

        order.append([track('c')]);
        prepareAll(rundown, order);

        expect(rundown.nowPlaying()?.item.externalId).toBe('a');
        expect(rundown.servedCount()).toBe(1);
        expect(rundown.upcoming().map(entry => entry.externalId)).toEqual([served!.item.externalId, 'c']);
    });

    it('announces no reset, because the plan is continuing rather than changing', () => {
        // A reset is what makes the pusher flush the player's queue. Preparing a top-up that
        // announced one would drop the very items it is filling in behind.
        const rundown = new Rundown(new StubResolver(), logger);
        const order = orderOf(rundown, ['a']);
        const resets: boolean[] = [];
        rundown.onReset(standingDown => resets.push(standingDown));

        order.append([track('b')]);
        prepareAll(rundown, order);

        expect(resets).toEqual([]);
    });

    it('wakes the pusher, so a station that had drained starts again', () => {
        const rundown = new Rundown(new StubResolver(), logger);
        const order = orderOf(rundown, []);
        const changed = vi.fn();
        rundown.onChange(changed);

        order.append([track('a')]);
        prepareAll(rundown, order);

        expect(changed).toHaveBeenCalled();
        expect(rundown.hasProgramme()).toBe(true);
    });

    it('says nothing when there is nothing to prepare', () => {
        const rundown = rundownWith(['a']);
        const changed = vi.fn();
        rundown.onChange(changed);

        rundown.prepare([]);

        expect(changed).not.toHaveBeenCalled();
    });

    it('will not offer an item the director has not prepared', async () => {
        // An item in the order with no playable form is a PLAN, not something the player
        // could be given: a segment whose row has not been read yet is exactly that.
        const rundown = new Rundown(new StubResolver(), logger);
        const order = orderOf(rundown, ['a']);
        order.append([track('b')]);

        expect(rundown.upcoming().map(entry => entry.externalId)).toEqual(['a']);
        await rundown.next();
        expect(await rundown.next()).toBeUndefined();
    });
});

describe('Rundown.onAired', () => {
    it('fires when the player confirms an item, not when it was handed over', async () => {
        // Handing over runs an item ahead of the listener. History, now-playing and
        // any back-announce hung off `next()` are all a track early.
        const rundown = rundownWith(['a', 'b']);
        const aired: string[] = [];
        rundown.onAired(item => aired.push(item.externalId));

        const pulled = await rundown.next();
        await rundown.next();
        expect(aired).toEqual([]);

        rundown.markAired(pulled!.item.id);
        expect(aired).toEqual(['a']);
    });

    it('fires once per item, however many times the player confirms it', async () => {
        // The notify and the reading both name the same item; only the first is news.
        const rundown = rundownWith(['a']);
        const aired: string[] = [];
        rundown.onAired(item => aired.push(item.externalId));

        const pulled = await rundown.next();
        rundown.markAired(pulled!.item.id);
        rundown.markAired(pulled!.item.id);
        rundown.reconcile({ queued: 0, ready: true, onAir: pulled!.item.id });

        expect(aired).toEqual(['a']);
    });

    it('fires for an item a reading is the first to name', async () => {
        // A dropped notify must not lose the event: the reconcile is the recovery
        // path for exactly this, and history cannot afford to miss a track.
        const rundown = rundownWith(['a']);
        const aired: string[] = [];
        rundown.onAired(item => aired.push(item.externalId));

        const pulled = await rundown.next();
        rundown.reconcile({ queued: 0, ready: true, onAir: pulled!.item.id });

        expect(aired).toEqual(['a']);
    });

    it('says nothing about an id this process never handed over', () => {
        // A Liquidsoap that outlived a restart is still playing something. There is
        // nothing truthful to record about it, so it is not invented into history.
        const rundown = rundownWith(['a']);
        const aired = vi.fn();
        rundown.onAired(aired);

        rundown.reconcile({ queued: 0, ready: true, onAir: 'from-a-previous-session' });

        expect(aired).not.toHaveBeenCalled();
    });

    it('keeps going when a listener throws, and does not take the boundary down with it', async () => {
        // This runs on the track boundary with the next item already fetching. One
        // broken subscriber must cost its own event and nothing else.
        const rundown = rundownWith(['a']);
        const aired: string[] = [];
        rundown.onAired(() => {
            throw new Error('a subscriber blew up');
        });
        rundown.onAired(item => aired.push(item.externalId));

        const pulled = await rundown.next();
        expect(() => rundown.markAired(pulled!.item.id)).not.toThrow();

        expect(aired).toEqual(['a']);
        expect(rundown.nowPlaying()?.item.externalId).toBe('a');
    });

    it('stops firing once unsubscribed', async () => {
        const rundown = rundownWith(['a', 'b']);
        const aired = vi.fn();
        const unsubscribe = rundown.onAired(aired);
        unsubscribe();

        const pulled = await rundown.next();
        rundown.markAired(pulled!.item.id);

        expect(aired).not.toHaveBeenCalled();
    });
});

// Resolving is the longest await in the transport: a provider call for a track, a database read for
// a segment. The running order can be replaced or dropped entirely while one is in flight, because
// `retract` and `reset` run synchronously from a request handler on the same thread. What must not
// happen is the resolved item landing in a running order that no longer exists.
describe('Rundown resolving across a change of plan', () => {
    /** A resolver whose answer can be released by the test, so an await can be held open. */
    const heldResolver = () => {
        let release: (() => void) | undefined;
        const started = new Promise<void>(resolve => (release = resolve));
        let unblock: (() => void) | undefined;
        const held = new Promise<void>(resolve => (unblock = resolve));

        class Held extends TrackResolver {
            async resolve(): Promise<string> {
                release?.();
                await held;
                return 'https://example.test/audio.ogg';
            }
        }
        return { resolver: new Held(), started, unblock: () => unblock?.() };
    };

    it('drops an item whose running order was stood down mid-resolve', async () => {
        const { resolver, started, unblock } = heldResolver();
        const rundown = new Rundown(resolver, logger);
        orderOf(rundown, ['a', 'b']);

        const pulling = rundown.next();
        await started;
        // The operator's Stop, landing exactly inside the resolve.
        rundown.reset();
        unblock();

        expect(await pulling).toBeUndefined();
        // Nothing was handed over, so nothing can be pushed to the player afterwards.
        expect(rundown.servedCount()).toBe(0);
        expect(rundown.hasProgramme()).toBe(false);
    });

    it('drops an item whose running order was replaced mid-resolve', async () => {
        const { resolver, started, unblock } = heldResolver();
        const rundown = new Rundown(resolver, logger);
        const order = orderOf(rundown, ['a']);

        const pulling = rundown.next();
        await started;
        rundown.retract();
        unblock();

        expect(await pulling).toBeUndefined();
        // The item is back where it started rather than half handed over, which is the whole
        // difference the shared order makes: it used to be dropped from a second list while the
        // plan behind it went on believing it had been committed.
        expect(order.all()[0]!!.state).toBe('planned');
        expect(rundown.servedCount()).toBe(0);
    });

    it('hands the item over as usual when nothing changed', async () => {
        const { resolver, started, unblock } = heldResolver();
        const rundown = new Rundown(resolver, logger);
        orderOf(rundown, ['a']);

        const pulling = rundown.next();
        await started;
        unblock();

        expect((await pulling)?.item.externalId).toBe('a');
        expect(rundown.servedCount()).toBe(1);
    });
});

// A talk-over rides on the record it is heard over. The rundown carries it without interpreting it,
// the way it carries trackId, and resolves it through the same chain so there is one place that
// knows how to turn something into audio the player can fetch.
describe('Rundown resolving a talk-over cue', () => {
    it('resolves the cue alongside the record and hands both over', async () => {
        const rundown = new Rundown(new StubResolver(), logger);
        seedWith(rundown, [{ ...track('a'), voice: { segmentId: 'seg-1', atMs: 8000 } }]);

        const pulled = await rundown.next();

        expect(pulled?.url).toBe('https://example.test/a.ogg');
        expect(pulled?.voice).toEqual({ url: 'https://example.test/seg-1.ogg', atMs: 8000 });
    });

    it('hands the record over without a cue when nothing asked for one', async () => {
        const rundown = new Rundown(new StubResolver(), logger);
        orderOf(rundown, ['a']);

        expect((await rundown.next())?.voice).toBeUndefined();
    });

    // The right way round: a DJ missing a break is a quiet failure, a record missing is an audible
    // one. The cue is the part that gives way.
    it('airs the record anyway when the cue will not resolve', async () => {
        const rundown = new Rundown(new StubResolver(new Set(['seg-1'])), logger);
        seedWith(rundown, [{ ...track('a'), voice: { segmentId: 'seg-1', atMs: 8000 } }]);

        const pulled = await rundown.next();

        expect(pulled?.item.externalId).toBe('a');
        expect(pulled?.voice).toBeUndefined();
    });
});

// Once the record it rides is on air, a talk-over cue is settled by the mixer's OWN
// reading of whether it spoke, rather than left for the boundary sweep to guess from
// position. The boundary sweep is still what catches a reading that never arrives.
describe('Rundown settling a talk-over from the mixer', () => {
    it('settles the cue from a reading naming its carrier', async () => {
        const rundown = new Rundown(new StubResolver(), logger);
        const order = new StationLineup({ name: 'Test', mode: 'rotation', onEnd: 'extend', source: 'import' });
        order.replaceFrom(['a', 'b'].map(track));
        order.insertSegment('spoke', 0, { atMs: 500 });
        order.insertSegment('quiet', 2, { atMs: 500 });
        rundown.attach(order);

        const [spoke, a, quiet, b] = order.all();
        // Marked handed here, exactly as `DirectorService.toPlayerItems` does it: a cue is
        // never given to the player in its own right, so this class hands itself over.
        order.markHanded(spoke!.id);
        order.markHanded(quiet!.id);
        rundown.prepare([
            { ...track('a'), id: a!.id, voice: { segmentId: 'spoke', atMs: 500, itemId: spoke!.id } },
            { ...track('b'), id: b!.id, voice: { segmentId: 'quiet', atMs: 500, itemId: quiet!.id } },
        ]);

        const first = await rundown.next();
        rundown.markAired(first!.item.id);

        // `queued` set well above what is actually handed throughout, so this test is
        // about the voice reading and not about `reconcileServed`'s own lost-push logic.
        rundown.reconcile({ queued: 5, ready: true, onAir: a!.id, voice: 'armed' });
        expect(spoke!.state).toBe('handed');

        rundown.reconcile({ queued: 5, ready: true, onAir: a!.id, voice: 'fired' });
        expect(spoke!.state).toBe('played');

        const second = await rundown.next();
        rundown.markAired(second!.item.id);

        rundown.reconcile({ queued: 5, ready: true, onAir: b!.id, voice: 'missed' });

        expect(quiet!.state).toBe('skipped');
        expect(logger.warn).toHaveBeenCalledWith('rundown: a talk-over cue missed its record', expect.objectContaining({ item: quiet!.id }));
    });

    it('matches the reading against the carrier that armed it, not whatever the rundown currently calls on-air', async () => {
        // `settleVoice` checks the reading's `onAir` against the carrier recorded at
        // arm time rather than against `this.airing`, precisely so a reading that
        // still names that carrier is honoured on its own terms.
        const rundown = new Rundown(new StubResolver(), logger);
        const order = new StationLineup({ name: 'Test', mode: 'rotation', onEnd: 'extend', source: 'import' });
        order.replaceFrom(['a', 'b'].map(track));
        order.insertSegment('spoke', 0, { atMs: 500 });
        rundown.attach(order);

        const [spoke, a, b] = order.all();
        order.markHanded(spoke!.id);
        rundown.prepare([
            { ...track('a'), id: a!.id, voice: { segmentId: 'spoke', atMs: 500, itemId: spoke!.id } },
            { ...track('b'), id: b!.id },
        ]);

        const first = await rundown.next();
        rundown.markAired(first!.item.id);

        // A reading naming anything other than the armed carrier is not about this
        // cue and is left alone — a foreign id the station never handed out, so it
        // cannot be mistaken for a real boundary either.
        rundown.reconcile({ queued: 5, ready: true, onAir: 'not-anything-this-order-holds', voice: 'fired' });
        expect(spoke!.state).toBe('handed');

        // The one naming the carrier that was actually armed still settles it.
        rundown.reconcile({ queued: 5, ready: true, onAir: a!.id, voice: 'fired' });
        expect(spoke!.state).toBe('played');
    });
});
