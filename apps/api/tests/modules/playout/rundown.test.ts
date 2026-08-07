// The rundown exists to keep one distinction straight: handing an item to the
// player is not the same as it airing. Liquidsoap downloads the next request while
// the previous one is still playing, so an app that conflates the two is a full
// item ahead of the listener — wrong for now-playing, for history, and for anything
// that ever times a break.
//
// So these tests are mostly about the recovery paths, because those are the ones a
// running station exercises and nobody watches: a dropped push, a notify that never
// arrived, a Liquidsoap that restarted and forgot everything it was handed.

import { describe, expect, it, vi } from 'vitest';

import { Rundown, type RundownTrack } from '../../../src/modules/playout/rundown.js';
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
    durationMs: 200_000,
});

const rundownWith = (ids: string[], resolver: TrackResolver = new StubResolver()): Rundown => {
    const rundown = new Rundown(resolver, logger);
    rundown.load(ids.map(track));
    return rundown;
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

    it('gives each item an id of our own rather than reusing the provider id', async () => {
        // The id rides through Liquidsoap on the annotation and comes back on the
        // notify; a provider id would collide the moment a playlist repeats a track.
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

describe('Rundown.load and reset', () => {
    it('announces a reset so the transport can take back what has not aired', async () => {
        const rundown = rundownWith(['a']);
        const onReset = vi.fn();
        rundown.onReset(onReset);

        rundown.load([track('b')]);

        expect(onReset).toHaveBeenCalledOnce();
        expect((await rundown.next())?.item.externalId).toBe('b');
    });

    it('forgets what was handed over, so a stale notify cannot resurrect it', async () => {
        const rundown = rundownWith(['a']);
        const pulled = await rundown.next();

        rundown.load([track('b')]);

        expect(rundown.markAired(pulled!.item.id)).toBe(false);
    });

    it('leaves what is on air alone: a new order is not a reason to cut the listener off', async () => {
        const rundown = rundownWith(['a']);
        const pulled = await rundown.next();
        rundown.markAired(pulled!.item.id);

        rundown.load([track('b')]);

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

        rundown.load([{ pluginId: 'deadair.spotify', externalId: 'b', title: 'B', artists: ['An Artist'] }]);
        rundown.reset();

        expect(announced).toEqual([false, true]);
    });
});

describe('Rundown.append', () => {
    it('adds to the end without disturbing what the player already holds', async () => {
        // The whole point of appending rather than reloading: a top-up must not
        // retract items the player has already downloaded and hand them back.
        const rundown = rundownWith(['a', 'b']);
        const pulled = await rundown.next();
        rundown.markAired(pulled!.item.id);
        const served = await rundown.next();

        rundown.append([track('c')]);

        expect(rundown.nowPlaying()?.item.externalId).toBe('a');
        expect(rundown.servedCount()).toBe(1);
        expect(rundown.upcoming().map(entry => entry.externalId)).toEqual([served!.item.externalId, 'c']);
    });

    it('announces no reset, because the plan is continuing rather than changing', () => {
        // A reset is what makes the pusher flush the player's queue. An append that
        // announced one would drop the very items it is topping up behind.
        const rundown = rundownWith(['a']);
        const resets: boolean[] = [];
        rundown.onReset(standingDown => resets.push(standingDown));

        rundown.append([track('b')]);

        expect(resets).toEqual([]);
    });

    it('wakes the pusher, so a station that had drained starts again', () => {
        const rundown = rundownWith([]);
        const changed = vi.fn();
        rundown.onChange(changed);

        rundown.append([track('a')]);

        expect(changed).toHaveBeenCalled();
        expect(rundown.hasProgramme()).toBe(true);
    });

    it('says nothing for an empty append', () => {
        const rundown = rundownWith(['a']);
        const changed = vi.fn();
        rundown.onChange(changed);

        expect(rundown.append([])).toEqual([]);
        expect(changed).not.toHaveBeenCalled();
    });

    it('gives back the items it minted, so a caller can correlate its own plan', () => {
        const rundown = rundownWith([]);

        const [item] = rundown.append([track('a')]);

        expect(item!.externalId).toBe('a');
        expect(rundown.upcoming()[0]!.id).toBe(item!.id);
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
