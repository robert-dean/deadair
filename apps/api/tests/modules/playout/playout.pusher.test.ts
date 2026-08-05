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
        push: vi.fn(async (uri: string) => {
            pushed.push(uri);
            return options.pushLands ?? true;
        }),
        flush: vi.fn(async () => true),
        skip: vi.fn(async () => true),
    };
    return { control: control as unknown as PlayoutControlClient, pushed, spy: control };
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
        expect(spy.status.mock.invocationCallOrder[0]).toBeLessThan(spy.push.mock.invocationCallOrder[0]!);
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
        const { pusher, spy } = setup(['a'], { queued: 0, ready: true, onAir: 'x' });
        spy.skip.mockResolvedValueOnce(false);

        expect(await pusher.skipCurrent()).toBe(false);
    });
});

describe('PlayoutPusher lifecycle', () => {
    it('takes back what has not aired when the running order is replaced', async () => {
        // The station has abandoned that order; leaving it queued would air it anyway.
        const { pusher, rundown, spy } = setup(['a'], { queued: 0, ready: false });
        pusher.start();

        try {
            rundown.load([track('b')]);
            expect(spy.flush).toHaveBeenCalledOnce();
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
