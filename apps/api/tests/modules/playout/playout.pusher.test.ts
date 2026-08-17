// The pusher is the station's transport. Its whole design claim is that it
// RECONCILES rather than reacts: every pass takes a fresh reading and makes that the
// truth, instead of trusting what it pushed. These tests are that claim stated as
// behaviour — a Liquidsoap restart, a dropped push and an empty running order all
// have to be non-events.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_TARGET_LUFS, speechGainFor } from '../../../src/modules/playout/gain.js';
import { HARD_JOIN_MS } from '../../../src/modules/playout/annotate.js';
import { Heartbeat } from '../../../src/modules/shared/heartbeat.js';
import { PlayoutPusher } from '../../../src/modules/playout/playout.pusher.js';
import { Rundown, type RundownItem, type RundownTrack } from '../../../src/modules/playout/rundown.js';
import { StationLineup, isTrackItem } from '../../../src/modules/director/station.lineup.js';
import { TrackResolver } from '../../../src/modules/playout/playout.capability.js';
import { PLAYOUT_LEAD, type PlayoutControlClient, type QueueStatus } from '../../../src/modules/playout/liquidsoap.control.js';
import type { Logger } from '@maroonedsoftware/logger';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { AudienceWatch } from '../../../src/modules/playout/audience.watch.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

// Nothing stored, so the pusher levels to the default target. The gain arithmetic is
// `gain.test.ts`; what matters here is that a hand-over reads the setting at all.
const config = { get: vi.fn(() => '') } as unknown as AppConfig;

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
    artist: 'An Artist',
});

/**
 * A running order, attached and prepared, which is what the director does for the transport.
 *
 * The real `StationLineup` rather than a fake: it IS the `LiveOrder` the rundown drives, and the
 * point of these cases is what the two do together. Preparing is the director's half — it resolves
 * each item into the form the player can be handed — and here that is a straight copy, because a
 * record already carries everything it needs.
 */
function seed(rundown: Rundown, tracks: readonly RundownTrack[]): StationLineup {
    const order = new StationLineup({ name: 'Test', mode: 'rotation', onEnd: 'extend', source: 'import' });
    order.replaceFrom(tracks);
    rundown.attach(order);
    rundown.prepare(order.all().flatMap(item => (isTrackItem(item) ? [{ ...item.track, id: item.id } as RundownItem] : [])));
    return order;
}

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
        announce: vi.fn(async () => true),
        armVoice: vi.fn(async () => true),
        clearVoice: vi.fn(async () => true),
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
        announce: vi.fn(async () => true),
        armVoice: vi.fn(async () => true),
        clearVoice: vi.fn(async () => true),
    };

    return { control, pushed };
}

/**
 * The audience gate, as the pusher sees it.
 *
 * Open by default, because most of these tests are about the transport rather
 * than the gate: a station with listeners is the ordinary case, and the gate's
 * own behaviour is tested where it is named.
 */
function stubAudience(open = true) {
    const listeners = new Set<(open: boolean) => void>();
    const audience = {
        gateOpen: vi.fn(() => open),
        onChange: vi.fn((listener: (open: boolean) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }),
    };
    return {
        audience: audience as unknown as AudienceWatch,
        spy: audience,
        /** Move the gate and announce it, the way a real reading would. */
        set: (next: boolean) => {
            open = next;
            for (const listener of listeners) listener(next);
        },
    };
}

/**
 * A station with the first item ON AIR and the second already handed over: the
 * state an operator skip actually happens in, and the only one where "which item
 * does the answer name" is a question at all.
 */
async function onAirStation(ids: string[]) {
    const rundown = new Rundown(new StubResolver(), logger);
    seed(rundown, ids.map(track));
    const { control, pushed } = scriptedControl();
    const pusher = new PlayoutPusher(rundown, control as unknown as PlayoutControlClient, stubAudience().audience, config, new Heartbeat(), logger);

    // Hand the first item over…
    await pusher.reconcile();
    const first = itemId(pushed[0]!);

    // …then let the player report it on air, which frees the lead for the second.
    control.reading = { queued: 0, ready: true, onAir: first };
    await pusher.reconcile();
    const second = itemId(pushed[1]!);

    return { rundown, pusher, control, pushed, first, second };
}

function setup(ids: string[], reading: QueueStatus | undefined, options: { pushLands?: boolean; audience?: boolean } = {}) {
    const rundown = new Rundown(new StubResolver(), logger);
    seed(rundown, ids.map(track));
    const { control, pushed, spy } = stubControl(reading, options);
    const gate = stubAudience(options.audience ?? true);
    return { rundown, pusher: new PlayoutPusher(rundown, control, gate.audience, config, new Heartbeat(), logger), pushed, spy, gate };
}

describe('PlayoutPusher.reconcile', () => {
    it('fills the lead when the player is empty', async () => {
        // The lead is what Liquidsoap DOWNLOADS ahead: each item is fetched while the
        // previous one plays, and a skip can only land at once onto one that is already
        // fetched. Pushing fewer than the prefetch leaves it with nothing to resolve.
        const { pusher, pushed } = setup(['a', 'b', 'c', 'd'], { queued: 0, ready: false });

        await pusher.reconcile();

        expect(pushed).toHaveLength(PLAYOUT_LEAD);
        expect(pushed[0]).toContain('https://example.test/a.ogg');
        expect(pushed[0]).toMatch(/^annotate:deadair_item="/);
    });

    it('pushes nothing when the player already holds its lead', async () => {
        const { pusher, pushed } = setup(['a', 'b'], { queued: PLAYOUT_LEAD, ready: true, onAir: 'whatever' });

        await pusher.reconcile();

        expect(pushed).toHaveLength(0);
    });

    it('does not stack on top of what it is already holding', async () => {
        // Counting only its own hand-overs would push a full lead on top of a queue the
        // reading says is already deep, and leave the player deeper than intended.
        const { pusher, pushed } = setup(['a', 'b', 'c', 'd'], { queued: PLAYOUT_LEAD, ready: true, onAir: 'whatever' });

        await pusher.reconcile();

        expect(pushed).toHaveLength(0);
    });

    it('does not push again for an item the player is still fetching', async () => {
        // The reading omits the request being resolved, so the depth dips for as long as
        // the download takes. Topping up against that alone hands over an extra item
        // every pass until it completes.
        // The stub keeps answering with the same reading — nothing queued, nothing on
        // air — which is exactly what the player reports while it is downloading what
        // it was just given.
        const { pusher, pushed } = setup(['a', 'b', 'c', 'd'], { queued: 0, ready: false });

        await pusher.reconcile();
        expect(pushed).toHaveLength(PLAYOUT_LEAD);

        await pusher.reconcile();

        // Still the same items: the app knows it handed those over, whatever the
        // reading says about them.
        expect(pushed).toHaveLength(PLAYOUT_LEAD);
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
        vi.useFakeTimers();
        try {
            const { pusher, rundown, pushed } = setup(['a', 'b'], { queued: 0, ready: false });

            await pusher.reconcile();
            // One item, because the lead is one: the player holds the next record and nothing more.
            expect(pushed).toHaveLength(1);

            // Past the point where the player could still be fetching it: everything handed over
            // is forgotten by the player, so it comes back to us.
            vi.advanceTimersByTime(30_000);
            rundown.reconcile({ queued: 0, ready: false });
            await pusher.reconcile();

            expect(pushed).toHaveLength(2);
            expect(pushed[1]).toContain('https://example.test/a.ogg');
        } finally {
            vi.useRealTimers();
        }
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

    it('still takes a reading when the renewal is the call that failed', async () => {
        // One call carried both jobs, so a single failed renewal also lost the reading —
        // and losing the reading is the silent half: nothing clears an airing item except a
        // reading that contradicts it, so the console went on naming a record that had
        // finished several tracks earlier while the station played something else.
        const { pusher, pushed, spy } = setup(['a', 'b', 'c', 'd'], { queued: 0, ready: false });
        spy.assertOnAir.mockResolvedValue(undefined);

        await pusher.reconcile();

        expect(spy.status).toHaveBeenCalledOnce();
        expect(pushed).toHaveLength(PLAYOUT_LEAD);
    });

    it('does not pay for the second call when the renewal answers', async () => {
        // The happy path is one request for both, which is why the fallback is on the
        // failure path rather than beside it.
        const { pusher, spy } = setup(['a'], { queued: 0, ready: true, onAir: 'x' });

        await pusher.reconcile();

        expect(spy.assertOnAir).toHaveBeenCalledOnce();
        expect(spy.status).not.toHaveBeenCalled();
    });

    it('does not renew the lease while nobody is listening', async () => {
        // The audience gate. There is a programme and a reachable stream, and the
        // station still must not hold the mount: every track it aired would be a
        // provider fetch and a download spent on an empty room.
        const { pusher, spy } = setup(['a'], { queued: 0, ready: true }, { audience: false });

        await pusher.reconcile();

        expect(spy.assertOnAir).not.toHaveBeenCalled();
        expect(spy.status).toHaveBeenCalledOnce();
    });

    it('renews the lease as soon as somebody is listening', async () => {
        const { pusher, spy, gate } = setup(['a'], { queued: 0, ready: true }, { audience: false });
        await pusher.reconcile();

        gate.set(true);
        await pusher.reconcile();

        expect(spy.assertOnAir).toHaveBeenCalledOnce();
    });

    it('hands over nothing while the gate is shut', async () => {
        // Not an optimisation missed: Liquidsoap keeps consuming a queue whether or not
        // the gate above it is open (measured on the running stack), so an item handed
        // over now plays out to an empty mount and takes a download with it. That is
        // the exact cost this gate exists to avoid.
        const { pusher, pushed } = setup(['a', 'b', 'c'], { queued: 0, ready: false }, { audience: false });

        await pusher.reconcile();

        expect(pushed).toHaveLength(0);
    });

    it('hands the full lead over the moment somebody listens', async () => {
        const { pusher, pushed, gate } = setup(['a', 'b', 'c'], { queued: 0, ready: false }, { audience: false });
        await pusher.reconcile();

        gate.set(true);
        await pusher.reconcile();

        expect(pushed).toHaveLength(PLAYOUT_LEAD);
    });

    it('labels the mount with what actually started', async () => {
        // The annotation on the pushed uri rides a track boundary, and the switches
        // between the queue and the output move mid-track by design, so a label left to
        // propagate is a label the mount may never see. Measured live: it lagged the
        // running order by two items and then stopped.
        const { pusher, rundown, spy } = setup(['a'], { queued: 0, ready: true });
        pusher.start();
        await pusher.reconcile();

        const item = rundown.upcoming()[0] ?? rundown.nowPlaying()?.item;
        rundown.markAired(item!.id);
        await new Promise(resolve => setImmediate(resolve));
        pusher.stop();

        expect(spy.announce).toHaveBeenCalledWith('An Artist - Track a');
    });

    it('takes back what the player holds once nobody is listening', async () => {
        // Letting the lease lapse would leave Liquidsoap playing everything already
        // handed over, to nobody, at a download each. Releasing drops the queue, and
        // the reading it answers with puts those items back in the running order.
        const { pusher, spy, gate } = setup(['a', 'b'], { queued: 1, ready: true, onAir: 'x' });
        await pusher.reconcile();
        expect(spy.releaseOnAir).not.toHaveBeenCalled();

        gate.set(false);
        await pusher.reconcile();

        expect(spy.releaseOnAir).toHaveBeenCalledOnce();
    });

    it('takes back what a Liquidsoap that outlived the app is holding', async () => {
        // No edge to hang it on: the app came up with the gate already shut, in front
        // of a player still holding items from a process that no longer exists. Those
        // are being consumed right now, which is why this is checked every pass.
        const { pusher, spy } = setup([], { queued: 2, ready: true, onAir: 'x' }, { audience: false });

        await pusher.reconcile();

        expect(spy.releaseOnAir).toHaveBeenCalledOnce();
    });

    it('says nothing to a player that is already empty', async () => {
        // Otherwise this fires a command at Liquidsoap every couple of seconds, forever,
        // for a station nobody is listening to.
        const { pusher, spy } = setup([], { queued: 0, ready: false }, { audience: false });

        await pusher.reconcile();

        expect(spy.releaseOnAir).not.toHaveBeenCalled();
    });
});

// Measured on the running station: an API killed without standing down leaves its pushes in the
// player, they still resolve, and Liquidsoap airs that dead plan in turn — the mount announcing a
// talk break and a record from a running order that ended forty minutes earlier, while the console
// showed the current one. Neither guard in the loop could correct it: the top-up defers to a depth
// it did not create, and the rundown stands its own clock down over an item it cannot speak for.
describe('PlayoutPusher and a player holding somebody else’s plan', () => {
    /** A control whose flush actually empties the queue, which is the half the reclaim turns on. */
    function reclaimable(reading: QueueStatus) {
        const pushed: string[] = [];
        const control = {
            reading,
            status: vi.fn(async () => control.reading),
            assertOnAir: vi.fn(async () => control.reading),
            releaseOnAir: vi.fn(async () => control.reading),
            push: vi.fn(async (uri: string) => {
                pushed.push(uri);
                return true;
            }),
            flush: vi.fn(async () => {
                control.reading = { ...control.reading, queued: 0 };
                return control.reading;
            }),
            skip: vi.fn(async () => control.reading),
            announce: vi.fn(async () => true),
            armVoice: vi.fn(async () => true),
            clearVoice: vi.fn(async () => true),
        };
        return { control, pushed };
    }

    function station(ids: string[], reading: QueueStatus) {
        const rundown = new Rundown(new StubResolver(), logger);
        const order = seed(rundown, ids.map(track));
        const { control, pushed } = reclaimable(reading);
        const pusher = new PlayoutPusher(
            rundown,
            control as unknown as PlayoutControlClient,
            stubAudience().audience,
            config,
            new Heartbeat(),
            logger,
        );
        return { rundown, order, pusher, control, pushed };
    }

    it('drops a queue it never handed over, even while the item on air is one it can speak for', async () => {
        // The first pass after a restart, which is the earliest this is catchable and the one that
        // looks least wrong: the item on air IS in the persisted order, so it is adopted quite
        // correctly, and the dead plan is the part waiting behind it.
        const { order, pusher, control, pushed } = station(['a', 'b', 'c', 'd'], { queued: 3, ready: true });
        control.reading = { ...control.reading, onAir: order.all()[0]!.id };

        await pusher.reconcile();

        expect(control.flush).toHaveBeenCalledOnce();
        // And it fills the lead in the same pass, off the depth the flush produced rather than the
        // one it replaced — otherwise the station is silent until the next tick.
        expect(pushed).toHaveLength(PLAYOUT_LEAD);
    });

    it('drops the queue behind a record from a running order it does not hold', async () => {
        const { pusher, control } = station(['a', 'b', 'c'], { queued: 2, ready: true, onAir: 'from-a-previous-session' });

        await pusher.reconcile();

        expect(control.flush).toHaveBeenCalledOnce();
    });

    it('reclaims once per stranger, rather than eating its own top-up every pass', async () => {
        // `flush` leaves what is ON AIR alone, so the stranger is still playing on the next pass and
        // still the reason to reclaim — by which time everything queued is this station's own.
        // Flushing again there would drop the running order every couple of seconds forever.
        const { pusher, control, pushed } = station(['a', 'b', 'c', 'd'], { queued: 2, ready: true, onAir: 'from-a-previous-session' });

        await pusher.reconcile();
        const filled = pushed.length;
        control.reading = { ...control.reading, queued: filled };
        await pusher.reconcile();
        await pusher.reconcile();

        expect(control.flush).toHaveBeenCalledOnce();
        expect(pushed).toHaveLength(filled);
    });

    it('leaves the stranger playing rather than cutting it off mid-record', async () => {
        // What a listener hears this way is one record that was not planned, then the station. A
        // skip would make it one record chopped in half.
        const { pusher, control } = station(['a', 'b'], { queued: 2, ready: true, onAir: 'from-a-previous-session' });

        await pusher.reconcile();

        expect(control.skip).not.toHaveBeenCalled();
    });

    it('clears an armed cue with the queue it belonged to', async () => {
        // The cue was armed against a boundary in the dead plan, and left armed it fires over the
        // first record of this one.
        const { pusher, control } = station(['a', 'b'], { queued: 2, ready: true, onAir: 'from-a-previous-session' });

        await pusher.reconcile();

        expect(control.clearVoice).toHaveBeenCalled();
    });

    it('says nothing to a player whose queue is its own', async () => {
        const { pusher, control } = station(['a', 'b', 'c', 'd'], { queued: 0, ready: false });

        await pusher.reconcile();
        // Everything queued now is what that pass handed over.
        control.reading = { ...control.reading, queued: PLAYOUT_LEAD, ready: true };
        await pusher.reconcile();

        expect(control.flush).not.toHaveBeenCalled();
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
            rundown.retract();
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

        rundown.retract();

        expect(spy.flush).not.toHaveBeenCalled();
    });
});

// Every pass through the push loop spans two awaits: resolving the item and pushing it. Both halves
// of "should the station be on air" can change inside either of them.
describe('PlayoutPusher pushing across a change underneath it', () => {
    /** The pusher over a running order, with an audience gate the test can close mid-push. */
    const build = (onFirstPush: () => void) => {
        const rundown = new Rundown(new StubResolver(), logger);
        seed(rundown, [track('a'), track('b'), track('c'), track('d')]);

        const reading: QueueStatus = { queued: 0, ready: false, remainingMs: -1, driving: true };
        const pushed: string[] = [];
        let open = true;

        const control = {
            status: vi.fn(async () => reading),
            assertOnAir: vi.fn(async () => reading),
            releaseOnAir: vi.fn(async () => reading),
            push: vi.fn(async (uri: string) => {
                pushed.push(uri);
                if (pushed.length === 1) onFirstPush();
                return true;
            }),
            flush: vi.fn(async () => reading),
            skip: vi.fn(async () => reading),
            announce: vi.fn(async () => true),
            armVoice: vi.fn(async () => true),
            clearVoice: vi.fn(async () => true),
        } as unknown as PlayoutControlClient;

        const audience = { gateOpen: () => open, onChange: () => () => {} } as unknown as AudienceWatch;
        const pusher = new PlayoutPusher(rundown, control, audience, config, new Heartbeat(), logger);

        return { pusher, pushed, rundown, close: () => (open = false) };
    };

    // The case that bites. A Stop empties the running order so the loop runs out of items by
    // itself; a gate that shuts leaves the order intact, and a loop trusting the reading it
    // started with would fill the player's whole lead for a mount nobody is hearing — a provider
    // fetch and a download per track, which is precisely what WARM_LEAD exists to prevent.
    // At a `PLAYOUT_LEAD` of 1 there is no second push for a closing gate to catch, so what is
    // asserted is the pass AFTER: the loop re-reads the gate rather than trusting the reading it
    // started with, and a mount nobody is hearing gets no further records.
    it('stops filling the lead when the last listener leaves mid-push', async () => {
        const harness = build(() => harness.close());

        await harness.pusher.reconcile();
        expect(harness.pushed).toHaveLength(1);

        // The item pushed above airs, which would ordinarily make room for the next one.
        const head = harness.rundown.upcoming()[0];
        if (head) harness.rundown.markAired(head.id);
        await harness.pusher.reconcile();

        expect(harness.pushed).toHaveLength(1);
    });

    it('fills the whole lead while somebody is still listening', async () => {
        const harness = build(() => undefined);

        await harness.pusher.reconcile();

        expect(harness.pushed).toHaveLength(PLAYOUT_LEAD);
    });

    it('stops feeding the player when the station is stood down mid-push', async () => {
        const harness = build(() => harness.rundown.reset());

        await harness.pusher.reconcile();

        expect(harness.pushed).toHaveLength(1);
    });
});

// The cue is armed as the record is handed over: the earliest honest moment, because the item id
// exists and the item is committed, and the script waits for that record to actually start before
// it counts anything.
describe('PlayoutPusher arming a talk-over', () => {
    const build = (voice?: { url: string; atMs: number; loudnessLufs?: number }) => {
        const rundown = new Rundown(new StubResolver(), logger);
        seed(rundown, [
            {
                ...track('a'),
                ...(voice
                    ? {
                          voice: {
                              segmentId: 'seg-1',
                              atMs: voice.atMs,
                              ...(voice.loudnessLufs === undefined ? {} : { loudnessLufs: voice.loudnessLufs }),
                          },
                      }
                    : {}),
            },
        ]);

        const reading: QueueStatus = { queued: 0, ready: false, remainingMs: -1, driving: true };
        const control = {
            status: vi.fn(async () => reading),
            assertOnAir: vi.fn(async () => reading),
            releaseOnAir: vi.fn(async () => reading),
            push: vi.fn(async () => true),
            flush: vi.fn(async () => reading),
            skip: vi.fn(async () => reading),
            announce: vi.fn(async () => true),
            armVoice: vi.fn(async () => true),
            clearVoice: vi.fn(async () => true),
        };
        const audience = { gateOpen: () => true, onChange: () => () => {} } as unknown as AudienceWatch;

        return {
            pusher: new PlayoutPusher(rundown, control as unknown as PlayoutControlClient, audience, config, new Heartbeat(), logger),
            control,
            rundown,
        };
    };

    it('arms the cue against the item it rides on', async () => {
        const { pusher, control, rundown } = build({ url: 'https://example.test/seg-1.ogg', atMs: 8000 });
        // Read BEFORE the reconcile: once the record is handed over it is served rather than
        // upcoming, and the id is the whole point of the assertion — it is what radio.liq matches
        // the cue against, so arming with the wrong one means a cue that never fires.
        const itemId = rundown.upcoming()[0]!.id;

        await pusher.reconcile();

        expect(control.armVoice).toHaveBeenCalledWith(expect.stringContaining('https://example.test/seg-1.ogg'), itemId, 8000);
    });

    it('arms the cue with the gain the break is to air at', async () => {
        // The mic chain is the only thing between this uri and the mount, and the playout queue's
        // annotations never reach it -- so an unstamped cue is a break at whatever the speech
        // engine happened to produce, which measured about ten decibels under the music.
        const { pusher, control, rundown } = build({ url: 'https://example.test/seg-1.ogg', atMs: 8000 });
        const itemId = rundown.upcoming()[0]!.id;

        await pusher.reconcile();

        const armed = `annotate:liq_amplify="${speechGainFor({}, DEFAULT_TARGET_LUFS)} dB":https://example.test/seg-1.ogg`;
        expect(control.armVoice).toHaveBeenCalledWith(armed, itemId, 8000);
    });

    it('arms the cue against the segment\'s own measurement where there is one', async () => {
        // The talk-over never becomes a player item, so this is the ONLY route by which what the
        // segment measured reaches the thing that stamps its gain.
        const { pusher, control } = build({ url: 'https://example.test/seg-1.ogg', atMs: 8000, loudnessLufs: -22 });

        await pusher.reconcile();

        expect(control.armVoice).toHaveBeenCalledWith(expect.stringContaining('liq_amplify="4 dB"'), expect.any(String), 8000);
    });

    it('arms nothing for a record with no cue', async () => {
        const { pusher, control } = build();

        await pusher.reconcile();

        expect(control.armVoice).not.toHaveBeenCalled();
    });

    // A replacement does not go through /control/offair, so a cue left armed would fire over the
    // first record of the NEW running order.
    it('clears an armed cue when the running order is replaced', async () => {
        const { pusher, control, rundown } = build();
        pusher.start();

        rundown.retract();

        expect(control.clearVoice).toHaveBeenCalled();
        pusher.stop();
    });
});

// A blend is a property of the BOUNDARY, so the hand-over cannot decide it from the item
// in front of it. What these cases pin down is where the successor comes from: the running
// ORDER, not the player's queue, which is holding items handed over a pass ago.
describe('PlayoutPusher: the blend', () => {
    /** A measured record whose intro and outro are named by its id, so a stamp is readable. */
    const measured = (externalId: string, introMs: number, outroMs: number): RundownTrack => ({
        ...track(externalId),
        cueInMs: 0,
        introEndMs: introMs,
        outroStartMs: 200_000,
        cueOutMs: 200_000 + outroMs,
    });

    /** The blend the pusher stamped on a pushed uri, in seconds as Liquidsoap takes it. */
    const blend = (uri: string): string => /liq_cross_end_duration="([^"]+)"/.exec(uri)?.[1] ?? '';

    /** The blend the pusher stamped as an item's START buffer: the boundary BEFORE it. */
    const blendIn = (uri: string): string => /liq_cross_start_duration="([^"]+)"/.exec(uri)?.[1] ?? '';

    /** What a boundary the station does not blend carries. Never zero; see `annotate.ts`. */
    const HARD_JOIN = String(HARD_JOIN_MS / 1000);

    /**
     * Push the next item and let the player report it on air, so the pass behind it can push again.
     *
     * `PLAYOUT_LEAD` is one, so a boundary is one reconcile rather than a batch: a scenario about
     * consecutive records plays out across passes, which is what the station does anyway.
     */
    async function boundaries(pusher: PlayoutPusher, rundown: Rundown, count: number): Promise<void> {
        for (let index = 0; index < count; index++) {
            await pusher.reconcile();
            const head = rundown.upcoming()[0];
            if (head) rundown.markAired(head.id);
        }
    }

    function setupMeasured(tracks: readonly RundownTrack[], crossfade = true) {
        const rundown = new Rundown(new StubResolver(), logger);
        seed(rundown, tracks);
        rundown.setCrossfade(crossfade);
        const { control, pushed } = stubControl({ queued: 0, ready: false });
        return { rundown, pusher: new PlayoutPusher(rundown, control, stubAudience().audience, config, new Heartbeat(), logger), pushed };
    }

    it('sizes each stamp from the record that actually follows', async () => {
        // Three records handed over in one pass, so every stamp but the last has a
        // successor the order already knows about. The first blends against the second's
        // intro, the second against the third's.
        const { pusher, pushed, rundown } = setupMeasured([measured('a', 0, 30_000), measured('b', 6_000, 30_000), measured('c', 9_000, 30_000)]);

        await boundaries(pusher, rundown, 3);

        expect(blend(pushed[0]!)).toBe('6');
        expect(blend(pushed[1]!)).toBe('9');
    });

    it('stamps the same number on both records that form a boundary', async () => {
        // The bug this exists for, found by rendering a transition and measuring it: a
        // boundary is made of TWO records, and `cross` sizes it from the outgoing one's
        // end buffer and the incoming one's start buffer. Give it two different numbers
        // and it takes the shorter. The first version stamped one combined key per item
        // meaning "the boundary after me", so every blend was overruled by whatever the
        // next record said about ITS boundary -- which, for anything followed by a hard
        // join, was a hard join. Every blend on the station collapsed and nothing failed.
        const { pusher, pushed, rundown } = setupMeasured([measured('a', 0, 30_000), measured('b', 6_000, 30_000), measured('c', 9_000, 30_000)]);

        await boundaries(pusher, rundown, 3);

        expect(blend(pushed[0]!)).toBe('6');
        expect(blendIn(pushed[1]!)).toBe('6');
        expect(blend(pushed[1]!)).toBe('9');
        expect(blendIn(pushed[2]!)).toBe('9');
    });

    it('opens the first item of a broadcast with a hard join', async () => {
        // Nothing precedes it, so there is no boundary on that side to size.
        const { pusher, pushed } = setupMeasured([measured('a', 0, 30_000), measured('b', 6_000, 30_000)]);

        await pusher.reconcile();

        expect(blendIn(pushed[0]!)).toBe(HARD_JOIN);
    });

    it('stamps a hard join at the tail of what has been planned', async () => {
        // Nothing follows the last item, so there is no boundary to size. It has to be
        // stamped anyway: `persist_override` means an unstamped track inherits.
        const { pusher, pushed, rundown } = setupMeasured([measured('a', 0, 30_000), measured('b', 6_000, 30_000)]);

        await boundaries(pusher, rundown, 2);

        expect(pushed).toHaveLength(2);
        expect(blend(pushed[1]!)).toBe(HARD_JOIN);
    });

    it('stamps a hard join on every boundary of a broadcast that does not blend', async () => {
        // An album. Its gaps are somebody's decision, and the transport is told so by
        // the director rather than working it out.
        const { pusher, pushed, rundown } = setupMeasured(
            [measured('a', 0, 30_000), measured('b', 6_000, 30_000), measured('c', 9_000, 30_000)],
            false,
        );

        await boundaries(pusher, rundown, 3);

        expect(pushed.map(blend)).toEqual([HARD_JOIN, HARD_JOIN, HARD_JOIN]);
    });

    it('stamps a hard join next to an unmeasured record without disturbing its neighbours', async () => {
        // The ordinary state of a station part way through measuring its library: the
        // boundary either side of an unmeasured record is cold and the rest still blend.
        const { pusher, pushed, rundown } = setupMeasured([measured('a', 0, 30_000), track('b'), measured('c', 9_000, 30_000)]);

        await boundaries(pusher, rundown, 3);

        expect(blend(pushed[0]!)).toBe(HARD_JOIN);
        expect(blend(pushed[1]!)).toBe(HARD_JOIN);
    });
});

describe('PlayoutPusher.health', () => {
    // `PlayoutControlClient` sets `isUp` and `isOnAir` from the calls this loop makes, so a
    // loop that has stopped leaves both frozen at whatever they last said and the console
    // reports a station that is on air while the mount lease expires underneath it. Nothing
    // else in the reading can account for that, which is why it is measured here.

    // The two cases below assert an exact zero, which is a claim about the beat and the read
    // being the same moment rather than about how fast this machine is. On the real clock a
    // loaded suite can put milliseconds between them and the assertion starts failing for a
    // reason that has nothing to do with the loop, so they freeze the clock instead: both
    // `Heartbeat.beat` and `PlayoutPusher.health` take `now`, and under fake timers they read
    // the same one. The threshold is three reconcile passes and is not the thing to widen.
    afterEach(() => vi.useRealTimers());

    it('reports a loop that completed a pass as not stalled', async () => {
        vi.useFakeTimers();
        const heartbeat = new Heartbeat();
        const rundown = new Rundown(new StubResolver(), logger);
        seed(rundown, ['a'].map(track));
        const { control } = stubControl({ queued: 0, ready: false });
        const pusher = new PlayoutPusher(rundown, control, stubAudience().audience, config, heartbeat, logger);

        pusher.start();
        await pusher.reconcile();

        expect(pusher.health().stalledForMs).toBe(0);
        pusher.stop();
    });

    it('counts an early return as a completed pass', async () => {
        // Most passes exit early — the stream is unreachable, the queue is already full,
        // nothing is planned. Every one of those is the loop going round.
        vi.useFakeTimers();
        const heartbeat = new Heartbeat();
        const rundown = new Rundown(new StubResolver(), logger);
        const { control } = stubControl(undefined);
        const pusher = new PlayoutPusher(rundown, control, stubAudience().audience, config, heartbeat, logger);

        pusher.start();
        await pusher.reconcile();

        expect(pusher.health().stalledForMs).toBe(0);
        pusher.stop();
    });

    it('does not beat for a pass that threw, and quotes what it threw', async () => {
        // A loop that fails instantly on every tick would otherwise report as a healthy
        // one, which is the failure mode this whole reading exists to catch.
        const heartbeat = new Heartbeat();
        const rundown = new Rundown(new StubResolver(), logger);
        const control = {
            status: () => Promise.reject(new Error('socket hang up')),
            assertOnAir: () => Promise.reject(new Error('socket hang up')),
        } as unknown as PlayoutControlClient;
        const pusher = new PlayoutPusher(rundown, control, stubAudience().audience, config, heartbeat, logger);

        heartbeat.register('playout.reconcile', Date.now() - 60_000);
        await expect(pusher.reconcile()).rejects.toThrow('socket hang up');

        const health = pusher.health();
        expect(health.stalledForMs).toBeGreaterThan(30_000);
        expect(health.failure?.message).toBe('socket hang up');
    });

    it('clears the failure once a pass works again', async () => {
        const heartbeat = new Heartbeat();
        const rundown = new Rundown(new StubResolver(), logger);
        let fail = true;
        const control = {
            status: () => (fail ? Promise.reject(new Error('socket hang up')) : Promise.resolve(undefined)),
            assertOnAir: () => (fail ? Promise.reject(new Error('socket hang up')) : Promise.resolve(undefined)),
        } as unknown as PlayoutControlClient;
        const pusher = new PlayoutPusher(rundown, control, stubAudience().audience, config, heartbeat, logger);

        await expect(pusher.reconcile()).rejects.toThrow('socket hang up');
        fail = false;
        await pusher.reconcile();

        expect(pusher.health().failure).toBeUndefined();
    });

    it('reports nothing for a loop that was never started', () => {
        // A loop nobody registered is a question about this code rather than about the
        // station, so it must not read as a fault.
        const { pusher } = setup(['a'], { queued: 0, ready: false });

        expect(pusher.health().stalledForMs).toBeUndefined();
    });

    it('stops reporting on a loop that was stopped on purpose', () => {
        const { pusher } = setup(['a'], { queued: 0, ready: false });
        pusher.start();
        pusher.stop();

        expect(pusher.health().stalledForMs).toBeUndefined();
    });
});
