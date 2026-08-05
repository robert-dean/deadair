// The pusher is the station's transport. Its whole design claim is that it
// RECONCILES rather than reacts: every pass takes a fresh reading and makes that the
// truth, instead of trusting what it pushed. These tests are that claim stated as
// behaviour — a Liquidsoap restart, a dropped push and an empty running order all
// have to be non-events.

import { describe, expect, it, vi } from 'vitest';

import { PlayoutPusher } from '../../../src/modules/playout/playout.pusher.js';
import { Rundown, type RundownTrack } from '../../../src/modules/playout/rundown.js';
import { TrackResolver } from '../../../src/modules/playout/playout.capability.js';
import type { PlayoutControlClient, QueueStatus } from '../../../src/modules/playout/liquidsoap.control.js';
import type { Logger } from '@maroonedsoftware/logger';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

class StubResolver extends TrackResolver {
    async resolve(item: { externalId: string }): Promise<string | undefined> {
        return `https://example.test/${item.externalId}.ogg`;
    }
}

const track = (externalId: string): RundownTrack => ({
    pluginId: 'deadair.spotify',
    externalId,
    title: `Track ${externalId}`,
    artists: ['An Artist'],
});

/** A control client over a canned reading, recording what was pushed. */
function stubControl(reading: QueueStatus | undefined, options: { pushLands?: boolean } = {}) {
    const pushed: string[] = [];
    const control = {
        status: vi.fn(async () => reading),
        assertOnAir: vi.fn(async () => reading),
        releaseOnAir: vi.fn(async () => reading),
        push: vi.fn(async (uri: string) => {
            pushed.push(uri);
            return options.pushLands ?? true;
        }),
        flush: vi.fn(async () => reading),
        skip: vi.fn(async () => reading),
    };
    return { control: control as unknown as PlayoutControlClient, pushed, spy: control };
}

/** The rundown item id the pusher wrote onto a pushed uri. Nothing else exposes it. */
const itemId = (uri: string): string => /deadair_item="([^"]+)"/.exec(uri)?.[1] ?? '';

/**
 * A control client whose reading the test moves, and which can be told to change
 * it partway through a sequence of reads — which is the only way to stage a
 * boundary that lands AFTER the command that asked for it.
 */
function scriptedControl() {
    const pushed: string[] = [];
    let reads = 0;
    let switchAt: number | undefined;
    let switchTo: QueueStatus | undefined;

    const read = async () => {
        reads += 1;
        if (switchAt !== undefined && reads >= switchAt) control.reading = switchTo!;
        return control.reading;
    };

    const control = {
        reading: { queued: 0, ready: false } as QueueStatus,
        /** From the `nth` reading after this call onward, the player reports `next`. */
        readingAfter(nth: number, next: QueueStatus) {
            switchAt = reads + nth;
            switchTo = next;
        },
        status: vi.fn(read),
        // The lease renewal answers with the same reading, which is what lets it
        // replace the poll rather than join it.
        assertOnAir: vi.fn(read),
        releaseOnAir: vi.fn(read),
        push: vi.fn(async (uri: string) => {
            pushed.push(uri);
            return true;
        }),
        flush: vi.fn(async () => control.reading),
        skip: vi.fn(async () => control.reading),
    };

    return { control, pushed };
}

/**
 * A station with the first item ON AIR and the second already handed over: the
 * state an operator skip actually happens in, and the only one where "which item
 * does the answer name" is a question at all.
 */
async function onAirStation(ids: string[]) {
    const rundown = new Rundown(new StubResolver(), logger);
    rundown.load(ids.map(track));
    const { control, pushed } = scriptedControl();
    const pusher = new PlayoutPusher(rundown, control as unknown as PlayoutControlClient, logger);

    // Hand the first item over…
    await pusher.reconcile();
    const first = itemId(pushed[0]!);

    // …then let the player report it on air, which frees the lead for the second.
    control.reading = { queued: 0, ready: true, onAir: first };
    await pusher.reconcile();
    const second = itemId(pushed[1]!);

    return { rundown, pusher, control, pushed, first, second };
}

function setup(ids: string[], reading: QueueStatus | undefined, options: { pushLands?: boolean } = {}) {
    const rundown = new Rundown(new StubResolver(), logger);
    rundown.load(ids.map(track));
    const { control, pushed, spy } = stubControl(reading, options);
    return { rundown, pusher: new PlayoutPusher(rundown, control, logger), pushed, spy };
}

describe('PlayoutPusher.reconcile', () => {
    it('hands one item over when the player is empty', async () => {
        // The lead is one: Liquidsoap downloads the queued item while the previous one
        // plays, so pushing more buys nothing and pushing none leaves a gap.
        const { pusher, pushed } = setup(['a', 'b', 'c'], { queued: 0, ready: false });

        await pusher.reconcile();

        expect(pushed).toHaveLength(1);
        expect(pushed[0]).toContain('https://example.test/a.ogg');
        expect(pushed[0]).toMatch(/^annotate:deadair_item="/);
    });

    it('pushes nothing when the player already holds its lead', async () => {
        const { pusher, pushed } = setup(['a', 'b'], { queued: 1, ready: true, onAir: 'whatever' });

        await pusher.reconcile();

        expect(pushed).toHaveLength(0);
    });

    it('does nothing at all when the stream is unreachable', async () => {
        // A stream that is down is a normal state, not an error: the running order is
        // kept intact so it can be handed over when the stack comes back.
        const { pusher, pushed, rundown } = setup(['a'], undefined);

        await pusher.reconcile();

        expect(pushed).toHaveLength(0);
        expect(rundown.queuedCount()).toBe(1);
    });

    it('stops quietly when the running order is empty', async () => {
        const { pusher, pushed } = setup([], { queued: 0, ready: false });

        await pusher.reconcile();

        expect(pushed).toHaveLength(0);
    });

    it('re-offers an item whose push did not land', async () => {
        // The item was already popped off the queue, so losing it here would silently
        // drop it from the running order.
        const { pusher, rundown, pushed } = setup(['a', 'b'], { queued: 0, ready: false }, { pushLands: false });

        await pusher.reconcile();

        expect(pushed).toHaveLength(1);
        expect(rundown.queuedCount()).toBe(2);
        expect((await rundown.next())?.item.externalId).toBe('a');
    });

    it('refills after a Liquidsoap restart, with no app restart', async () => {
        // The reading comes back empty and names nothing; the next pass simply pushes
        // again. This is the case the reconcile design exists for.
        const { pusher, rundown, pushed } = setup(['a', 'b'], { queued: 0, ready: false });

        await pusher.reconcile();
        expect(pushed).toHaveLength(1);

        // Everything handed over is forgotten by the player, so it comes back to us.
        rundown.reconcile({ queued: 0, ready: false });
        await pusher.reconcile();

        expect(pushed).toHaveLength(2);
        expect(pushed[1]).toContain('https://example.test/a.ogg');
    });

    it('takes a reading before deciding what to hand over', async () => {
        // Ordering matters: pushing against a remembered depth rather than the player's
        // real one is how a queue gets over- or under-filled after a restart.
        const { pusher, rundown, spy } = setup(['a'], { queued: 0, ready: true, onAir: 'unknown-id' });
        const reconcileSpy = vi.spyOn(rundown, 'reconcile');

        await pusher.reconcile();

        expect(reconcileSpy).toHaveBeenCalledOnce();
        expect(spy.assertOnAir.mock.invocationCallOrder[0]).toBeLessThan(spy.push.mock.invocationCallOrder[0]!);
    });

    it('renews the lease while it has a programme, and reads without renewing when it does not', async () => {
        // The dead-man switch, from the app's side: an app that is merely running must
        // not hold a mount it has nothing to put on. This is the state a restart leaves
        // behind — the process is up, the rundown is empty, and Liquidsoap is still
        // holding an item nobody here handed it.
        const { pusher, rundown, spy } = setup(['a'], { queued: 1, ready: true, onAir: 'x' });

        await pusher.reconcile();
        expect(spy.assertOnAir).toHaveBeenCalledOnce();
        expect(spy.status).not.toHaveBeenCalled();

        rundown.reset();
        spy.assertOnAir.mockClear();
        await pusher.reconcile();

        expect(spy.assertOnAir).not.toHaveBeenCalled();
        expect(spy.status).toHaveBeenCalledOnce();
    });
});

describe('PlayoutPusher.skipCurrent', () => {
    it('tops the queue up before cutting, so the mount does not drop to the bed', async () => {
        // Skipping into an empty queue is legal but leaves the playout source
        // unavailable for a moment, which is audible.
        const { pusher, spy } = setup(['a', 'b'], { queued: 0, ready: true, onAir: 'x' });

        await pusher.skipCurrent();

        expect(spy.push.mock.invocationCallOrder[0]).toBeLessThan(spy.skip.mock.invocationCallOrder[0]!);
    });

    it('reports whether the stream actually took the command', async () => {
        // No reading back means nothing answered. A skip nobody heard must not be
        // reported as one that happened.
        const { pusher, spy } = setup(['a'], { queued: 0, ready: true, onAir: 'x' });
        spy.skip.mockResolvedValueOnce(undefined);

        expect(await pusher.skipCurrent()).toBe(false);
    });

    it('waits for the boundary, so the answer names the item that STARTED', async () => {
        // The whole point of the confirm: `playout_queue.skip()` advances in
        // Liquidsoap's streaming loop, so the reading that comes back with the
        // command still names the track that was cut. Answering from that is how a
        // skip reads as slow in the console.
        const { pusher, rundown, control, first, second } = await onAirStation(['a', 'b', 'c']);

        // The skip's own reading, and the first re-read after it, still name the
        // item that was cut. Only the second one shows the boundary.
        control.reading = { queued: 1, ready: true, onAir: first };
        control.readingAfter(3, { queued: 0, ready: true, onAir: second });

        vi.useFakeTimers();
        try {
            const skipped = pusher.skipCurrent();
            await vi.advanceTimersByTimeAsync(500);

            expect(await skipped).toBe(true);
            expect(rundown.nowPlaying()?.item.id).toBe(second);
        } finally {
            vi.useRealTimers();
        }
    });

    it('gives up after the budget rather than holding the operator', async () => {
        // A skip into a queue with nothing resolved behind it never produces a new
        // boundary: the mount falls to the local bed. That is a normal outcome, and
        // the answer still goes out.
        const { pusher, rundown, control, first } = await onAirStation(['a', 'b']);
        control.reading = { queued: 0, ready: true, onAir: first };

        vi.useFakeTimers();
        try {
            const skipped = pusher.skipCurrent();
            await vi.advanceTimersByTimeAsync(3000);

            expect(await skipped).toBe(true);
            expect(rundown.nowPlaying()?.item.id).toBe(first);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('PlayoutPusher lifecycle', () => {
    it('takes back what has not aired when the running order is replaced', async () => {
        // The station has abandoned that order; leaving it queued would air it anyway.
        // A flush and NOT a release: the station is still on air, and swapping the
        // running order is not a reason to cut the listener off mid-track.
        const { pusher, rundown, spy } = setup(['a'], { queued: 0, ready: false });
        pusher.start();

        try {
            rundown.load([track('b')]);
            expect(spy.flush).toHaveBeenCalledOnce();
            expect(spy.releaseOnAir).not.toHaveBeenCalled();
        } finally {
            pusher.stop();
        }
    });

    it('hands the mount back when the station stands down', async () => {
        // Standing down ends the broadcast, so it does not wait out the lease: an
        // operator who pressed stop has already given the command, and several more
        // seconds of audio after it is the console not being in charge.
        const { pusher, rundown, spy } = setup(['a'], { queued: 0, ready: false });
        pusher.start();

        try {
            rundown.reset();
            expect(spy.releaseOnAir).toHaveBeenCalledOnce();
            expect(spy.flush).not.toHaveBeenCalled();
        } finally {
            pusher.stop();
        }
    });

    it('stops listening once stopped', async () => {
        const { pusher, rundown, spy } = setup(['a'], { queued: 0, ready: false });
        pusher.start();
        pusher.stop();

        rundown.load([track('b')]);

        expect(spy.flush).not.toHaveBeenCalled();
    });
});
