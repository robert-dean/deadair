// Both routes here are gated on a bare shared secret presented by a process, not a
// session. That makes the gate itself the whole security boundary, and the two
// secrets are deliberately different: the login route hands out a Spotify access
// token, while the bridge only moves item ids around, so one leaking must not
// spend the other.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { PlayoutService } from '../../../src/modules/playout/playout.service.js';
import type { LiquidsoapEndpoint } from '../../../src/modules/playout/liquidsoap.endpoint.js';
import type { PlayoutControlClient } from '../../../src/modules/playout/liquidsoap.control.js';
import type { PlayoutPusher } from '../../../src/modules/playout/playout.pusher.js';
import type { Rundown } from '../../../src/modules/playout/rundown.js';
import type { DirectorConsoleService } from '../../../src/modules/director/director.console.service.js';
import type { StreamService } from '../../../src/modules/stream/stream.service.js';
import type { StreamConfigWarning, StreamConfigWatch } from '../../../src/modules/stream/stream.staleness.js';
import type { AudienceWatch } from '../../../src/modules/playout/audience.watch.js';
import type { ServedAudio, TrackAudioService } from '../../../src/modules/playout/audio/track.audio.service.js';
import type { ActivityRecorder } from '../../../src/modules/activity/activity.recorder.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

/**
 * The feed's write side, stubbed.
 *
 * Module-level like the logger, and for the same reason: what reaches it is asserted in the one
 * test below that is about the edge rule, and every other test here is about something else.
 */
const activity = { record: vi.fn(async () => undefined) } as unknown as ActivityRecorder;

const BRIDGE_SECRET = 'bridge-secret';

interface Options {
    bridgeSecret?: string;
    markAired?: boolean;
    /** What the import throws, if anything: the plugin narrowing lives inside it. */
    importError?: Error;
    /** Whether the stream took a skip, and whether it is reachable at all. */
    skipLands?: boolean;
    streamUp?: boolean;
    /** Whether the last reading said deadair's lease was holding the mount. */
    onAir?: boolean;
    /** How many clients Icecast has on the mount. */
    listeners?: number;
    /** Stream containers holding config the app has replaced. Empty is the ordinary state. */
    staleStreamConfig?: StreamConfigWarning[];
    /** What the audio service answers for a binding: bytes, or nothing it could get. */
    trackAudio?: ServedAudio;
    /** Whether the station has been stood down, and what it airs against. Both read per poll. */
    active?: boolean;
    airMode?: 'audience' | 'always';
    /** Whether the rundown has anything left to air, which is half of the on-air condition. */
    hasProgramme?: boolean;
    /**
     * Whether Icecast has ever answered with a count. Default true, because most of
     * these tests are about something else and a stats endpoint that never answered is a
     * fault in its own right.
     */
    audienceAnswered?: boolean;
    /** When the stream started refusing the app's bridge secret, if it is refusing it. */
    deniedSince?: number;
}

const item = { id: 'item-1', pluginId: 'deadair.spotify', externalId: 'trk_1', title: 'A Track', artists: ['An Artist'], durationMs: 200_000 };

function build(options: Options = {}) {
    const rundown = {
        markAired: vi.fn(() => options.markAired ?? true),
        load: vi.fn(),
        reset: vi.fn(),
        nowPlaying: vi.fn(() => undefined),
        upcoming: vi.fn(() => [] as unknown[]),
        queuedCount: vi.fn(() => 0),
        hasProgramme: vi.fn(() => options.hasProgramme ?? true),
    } as unknown as Rundown;

    const pusher = {
        reconcile: vi.fn(async () => {}),
        skipCurrent: vi.fn(async () => options.skipLands ?? true),
        health: () => ({}),
    } as unknown as PlayoutPusher;

    const control = {
        isUp: vi.fn(() => options.streamUp ?? true),
        isOnAir: vi.fn(() => options.onAir ?? true),
        noteStarve: vi.fn(),
        starvedSince: vi.fn(() => undefined),
        deniedSince: vi.fn(() => options.deniedSince),
    } as unknown as PlayoutControlClient;

    const director = {
        putOnAir: vi.fn(async () => {
            if (options.importError) throw options.importError;
            return { active: true, airMode: 'audience' as const, remaining: 0 };
        }),
        // Read on every status poll: whether the station was stood down is the one fact
        // the silence diagnosis cannot get from memory.
        getAir: vi.fn(async () => ({ active: options.active ?? true, airMode: options.airMode ?? ('audience' as const), remaining: 0 })),
    } as unknown as DirectorConsoleService;

    // Deliberately always resolves an address, even when the stream is down: that is
    // exactly what a pinned LIQUIDSOAP_CONTROL_URL does, and `streamUp` must not be
    // fooled by it.
    const endpoint = {
        secret: () => options.bridgeSecret ?? BRIDGE_SECRET,
        resolve: async () => 'http://127.0.0.1:8005',
    } as unknown as LiquidsoapEndpoint;

    const stream = { settings: async () => ({}) } as unknown as StreamService;

    // No drift by default: the containers running the config that was rendered for them
    // is the ordinary state, and the warning is tested where it is decided.
    const staleness = { warnings: () => options.staleStreamConfig ?? [] } as unknown as StreamConfigWatch;

    // The audience only decorates the reading here: what it does to the mount is
    // PlayoutPusher's, and is tested there.
    const audience = {
        listenerCount: () => options.listeners ?? 0,
        hasAudience: () => (options.listeners ?? 0) > 0,
        noteArrival: vi.fn(),
        // Answering by default, because an Icecast that has never answered is a fault and
        // most of these tests are about something else. No `readAt` at all is how "it has
        // never answered" is spelled, which is exactly the shape the real one has.
        reading: () => ({
            count: options.listeners ?? 0,
            hasAudience: (options.listeners ?? 0) > 0,
            ...(options.audienceAnswered === false ? {} : { readAt: Date.now() }),
        }),
    } as unknown as AudienceWatch;

    // Where a record's audio comes from. Disk, hold, provider and every failure between them are
    // covered in its own file; this is only what the route does with the answer.
    const trackAudio = { ensure: async () => options.trackAudio } as unknown as TrackAudioService;

    return {
        service: new PlayoutService(rundown, pusher, director, endpoint, control, audience, stream, trackAudio, staleness, activity, logger),
        audience,
        rundown,
        pusher,
        director,
        control,
    };
}

/** The status a thrown HttpError carries. */
const statusOf = async (call: Promise<unknown>): Promise<number> => {
    try {
        await call;
        return 200;
    } catch (error) {
        return (error as { status?: number; statusCode?: number }).status ?? (error as { statusCode?: number }).statusCode ?? 0;
    }
};

describe('PlayoutService.playPlaylist', () => {
    it('builds the running order from the playlist and goes on air', async () => {
        // The shortcut stays, because it is a useful one, but it goes the long way
        // round: two paths writing the running order would give the station two
        // writers with no idea of each other, and whichever ran last would win.
        //
        // One call rather than two now, because there is no import step left to make: putting a
        // playlist on air READS it, and nothing is stored in between.
        const { service, director } = build();

        await service.playPlaylist({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });

        expect(director.putOnAir).toHaveBeenCalledWith({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });
    });

    it('hands the first item over without waiting for the tick', async () => {
        // Otherwise the console's own response describes a station that has not started
        // yet, and the operator sees a stopped transport for up to a reconcile interval.
        const { service, pusher } = build();

        await service.playPlaylist({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });

        expect(pusher.reconcile).toHaveBeenCalledOnce();
    });

    it('lets the playlist read own the refusals it always owned', async () => {
        // 403/404/422/501/503 still come from the plugin narrowing inside the read, so this route
        // answers exactly as it did when it read the playlist itself.
        const forbidden = Object.assign(new Error('Forbidden'), { status: 403 });
        const { service, pusher } = build({ importError: forbidden });

        expect(await statusOf(service.playPlaylist({ pluginId: 'deadair.spotify', playlistId: 'pl_1' }))).toBe(403);
        expect(pusher.reconcile).not.toHaveBeenCalled();
    });
});

describe('PlayoutService.getStatus', () => {
    it('reports the stream as down when nothing answers', async () => {
        // A running order with no stream to hand it to plays nothing; a console that
        // showed the queue without saying so would be lying by omission.
        //
        // The stub endpoint still resolves an address here, which is the point: a
        // pinned LIQUIDSOAP_CONTROL_URL is returned unprobed, so liveness has to come
        // from a call that actually happened rather than from having an address.
        const { service } = build({ streamUp: false });

        expect((await service.getStatus()).streamUp).toBe(false);
    });

    it('tells a reachable stream apart from a station that is actually broadcasting', async () => {
        // The distinction the lease creates, and the one an operator most needs: the
        // control API answers, the mount is up, and what is going out is silence
        // because nothing is driving it. "Up" is not "on air".
        const { service } = build({ streamUp: true, onAir: false });

        const status = await service.getStatus();

        expect(status.streamUp).toBe(true);
        expect(status.onAir).toBe(false);
    });

    describe('the silence diagnosis it carries', () => {
        // The ordering is covered where it lives, in `silence.diagnosis.test.ts`. What
        // matters here is only that the snapshot is gathered from the right places: a
        // reading assembled from the wrong sources would be confidently wrong and there
        // would be nothing else in the response to contradict it.

        it('says a working station is airing', async () => {
            const { service } = build({ listeners: 2 });

            const { silence } = await service.getStatus();

            expect(silence.audible).toBe(true);
            expect(silence.cause).toBe('airing');
        });

        it('names the gate rather than leaving the console to infer it', async () => {
            const { service } = build({ streamUp: false });

            expect((await service.getStatus()).silence.cause).toBe('streamUnreachable');
        });

        it('takes the refused secret from the control client, so it is not read as a stream that is down', async () => {
            // The two look identical from here: every call fails and `isUp` is false either
            // way. The client is the only thing that saw a status code, so if the snapshot
            // does not carry its answer the operator is sent at the wrong container.
            const { service } = build({ streamUp: false, deniedSince: Date.now() - 30_000 });

            expect((await service.getStatus()).silence.cause).toBe('controlDenied');
        });

        it('reads whether the station was stood down from the director, not from the transport', async () => {
            // The one fact in the snapshot that is not in memory, and the reason the poll
            // is worth a row read: "nothing to air" and "somebody stopped it" are the two
            // most common quiet stations and they want opposite responses.
            const { service, director } = build({ active: false, listeners: 1 });

            expect((await service.getStatus()).silence.cause).toBe('stoodDown');
            expect(director.getAir).toHaveBeenCalled();
        });

        it('tells an Icecast that never answered from an empty room', async () => {
            // The pair this whole reading exists for. Same listener count, same `audience`
            // false, and only one of them is a station that will wait forever.
            const empty = build({ listeners: 0 });
            const blind = build({ listeners: 0, audienceAnswered: false });

            expect((await empty.service.getStatus()).silence.cause).toBe('noAudience');
            expect((await blind.service.getStatus()).silence.cause).toBe('audienceUnknown');
        });

        it('reports the gates it ruled out alongside the one that blocked', async () => {
            const { service } = build({ streamUp: false });

            const { silence } = await service.getStatus();

            expect(silence.checks).toHaveLength(10);
            expect(silence.checks.filter(check => check.state === 'ok').length).toBeGreaterThan(0);
        });
    });

    it('caps how much of the running order it carries', async () => {
        // This is polled every couple of seconds and a playlist can be hundreds long.
        const many = Array.from({ length: 50 }, (_, index) => ({ ...item, id: `item-${index}` }));
        const { service, rundown } = build();
        vi.mocked(rundown.upcoming).mockReturnValue(many);

        const status = await service.getStatus();

        expect(status.upNext).toHaveLength(10);
        // The full depth is still reported, so the console can say "and 40 more".
        expect(status.queuedCount).toBe(50);
    });

    it('counts what is coming from the same list it names, so the two cannot disagree', async () => {
        // They used to come from different accessors, one of which excluded the item
        // the player was already holding: the console named the track AFTER next as
        // next, and was one short on the count.
        const { service, rundown } = build();
        vi.mocked(rundown.upcoming).mockReturnValue([item, { ...item, id: 'item-2' }]);

        const status = await service.getStatus();

        expect(status.queuedCount).toBe(status.upNext.length);
        expect(status.upNext[0]?.id).toBe('item-1');
    });

    it('carries the playhead when the decoder reported one', async () => {
        const { service, rundown } = build();
        vi.mocked(rundown.nowPlaying).mockReturnValue({ item, startedAt: 1_700_000_000_000, remainingMs: 42_000 });

        expect((await service.getStatus()).nowPlaying).toEqual({
            item,
            startedAt: 1_700_000_000_000,
            remainingMs: 42_000,
        });
    });

    it('omits the playhead when the decoder could not say', async () => {
        const { service, rundown } = build();
        vi.mocked(rundown.nowPlaying).mockReturnValue({ item, startedAt: 1_700_000_000_000 });

        expect((await service.getStatus()).nowPlaying?.remainingMs).toBeUndefined();
    });
});

describe('PlayoutService.skip and stop', () => {
    it('reports a skip the stream did not take as a failure', async () => {
        // Answering 200 for a skip nobody heard leaves the console showing a track
        // change that never happened.
        const { service } = build({ skipLands: false });

        expect(await statusOf(service.skip())).toBe(409);
    });

    it('drops the running order on stop', async () => {
        const { service, rundown } = build();

        await service.stop();

        expect(rundown.reset).toHaveBeenCalledOnce();
    });
});

// The secret is no longer these handlers' business: they sit under /playout/bridge/, and
// `bridgeSecretMiddleware` has already refused anything that did not present it. The gate's
// own cases live in tests/server/middleware/bridge.secret.middleware.test.ts — deliberately
// in ONE place, since that is the point of gating the prefix rather than each handler.
describe('PlayoutService.noteListener', () => {
    it('answers with the header that admits the listener', () => {
        // Icecast is holding the client's connection open waiting for this. Without the
        // header it reads as a refusal, and the listener is turned away from a mount
        // that was perfectly willing to have them.
        const { service } = build();

        const answer = service.noteListener({ event: 'add' });

        expect(answer.headers.icecastAuthUser).toBe('1');
    });

    it('tells the audience which way the listener went', () => {
        const { service, audience } = build();

        service.noteListener({ event: 'add' });
        service.noteListener({ event: 'remove' });

        expect(audience.noteArrival).toHaveBeenNthCalledWith(1, true);
        expect(audience.noteArrival).toHaveBeenNthCalledWith(2, false);
    });
});

describe('PlayoutService.confirmAired', () => {
    it('records the item', () => {
        const { service, rundown } = build();

        service.confirmAired({ item: 'item-1' });

        expect(rundown.markAired).toHaveBeenCalledWith('item-1');
    });

    it('accepts an item the rundown does not hold', () => {
        // A Liquidsoap that outlived an app restart reports the item it is still
        // playing. The caller is a fire-and-forget http.post that cannot act on an
        // error, and the rundown declines to invent the id, which is the whole handling.
        const { service } = build({ markAired: false });

        expect(() => service.confirmAired({ item: 'from-a-previous-session' })).not.toThrow();
    });
});

describe('PlayoutService.noteStarve', () => {
    // The logger is a module-level mock shared by every test in this file, and the cases below
    // assert on what was NOT logged. Without this they would see calls from earlier describes.
    beforeEach(() => {
        (logger.warn as unknown as ReturnType<typeof vi.fn>).mockClear();
        (logger.debug as unknown as ReturnType<typeof vi.fn>).mockClear();
    });

    it('hands the next item over rather than waiting out the reconcile tick', () => {
        // The usual cause is a queue that ran dry or an item that failed to resolve, and
        // both are fixed by pushing. Waiting is the one response that guarantees the gap
        // lasts at least as long as the tick that would have noticed it.
        const { service, pusher } = build();

        service.noteStarve({ state: 'starved', forMs: 180_000 });

        expect(pusher.reconcile).toHaveBeenCalledOnce();
    });

    it('records the edge somewhere that outlives the request', () => {
        // This service is scoped per request, so a gap remembered on it would be forgotten
        // a millisecond after it arrived. The control client holds it because it is a fact
        // about the player and because it is the singleton that already holds the others.
        const { service, control } = build();

        service.noteStarve({ state: 'starved', forMs: 0 });
        expect(control.noteStarve).toHaveBeenCalledWith(true);

        service.noteStarve({ state: 'recovered', forMs: 3_000 });
        expect(control.noteStarve).toHaveBeenLastCalledWith(false);
    });

    it('does not push on a recovery, which is already the state it wanted', () => {
        const { service, pusher } = build();

        service.noteStarve({ state: 'recovered', forMs: 4_000 });

        expect(pusher.reconcile).not.toHaveBeenCalled();
    });

    it('never throws at the caller, which is a fire-and-forget post that cannot act on it', () => {
        const { service, pusher } = build();
        (pusher.reconcile as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('stream went away'));

        expect(() => service.noteStarve({ state: 'starved', forMs: 0 })).not.toThrow();
    });

    // Severity is decided on the RECOVERY, because that is the only edge that knows how long
    // the gap lasted. Getting this wrong is not cosmetic: every first listener produces a real
    // sub-second gap (the app queues nothing while the audience gate is shut), so warning at
    // the leading edge means a warning on every arrival, and a warning on every arrival is one
    // nobody reads.
    it('says nothing alarming when the gap opens, however long it turns out to be', () => {
        const { service } = build();

        service.noteStarve({ state: 'starved', forMs: 1_916_500 });

        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('stays quiet about a gap the reconcile closed within a tick', () => {
        // The ordinary first-listener case, measured at ~500ms on the running station.
        const { service } = build();

        service.noteStarve({ state: 'recovered', forMs: 500 });

        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('warns about a gap that outlived the loop meant to close it', () => {
        const { service } = build();

        service.noteStarve({ state: 'recovered', forMs: 30_000 });

        expect(logger.warn).toHaveBeenCalledOnce();
    });
});

/**
 * What reaches the activity feed, which is a much smaller set than what reaches the reading.
 *
 * The one rule these are all about: a row is written on an EDGE and never on a poll. The console
 * polls this service twice a second, so a producer that wrote per reading would turn the feed into
 * a log file with a primary key.
 */
describe('PlayoutService: what reaches the activity feed', () => {
    const recorded = () => activity.record as unknown as ReturnType<typeof vi.fn>;

    beforeEach(() => recorded().mockClear());

    it('writes a silence cause once when it changes, not once per poll', async () => {
        // Two polls of the same station. The first may or may not be a change — the last-said
        // cause is process-wide, exactly as it is in production — so it is the SECOND that is
        // asserted on, which is the poll that must write nothing.
        const { service } = build({ streamUp: false });

        await service.getStatus();
        recorded().mockClear();
        await service.getStatus();

        expect(recorded()).not.toHaveBeenCalled();
    });

    it('writes again when the cause actually changes', async () => {
        await build({ streamUp: false }).service.getStatus();
        recorded().mockClear();

        await build({ listeners: 2 }).service.getStatus();

        expect(recorded()).toHaveBeenCalledOnce();
        expect(recorded().mock.calls[0]?.[0]).toMatchObject({ module: 'playout', kind: 'silence.cause', data: { cause: 'airing' } });
    });

    it('carries a station that is only waiting as `info`, not as a fault', async () => {
        // The same argument the `ready` badge exists on: a station idling for want of a listener
        // and one that cannot reach its stream are both silent, and a feed that painted them the
        // same colour would undo it.
        await build({ streamUp: false }).service.getStatus();
        recorded().mockClear();

        await build({ active: false, listeners: 0 }).service.getStatus();

        expect(recorded().mock.calls[0]?.[0]).toMatchObject({ severity: 'info', data: { cause: 'stoodDown' } });
    });

    it('carries a gate that wants fixing as a fault', async () => {
        await build({ listeners: 2 }).service.getStatus();
        recorded().mockClear();

        await build({ streamUp: false }).service.getStatus();

        expect(recorded().mock.calls[0]?.[0]).toMatchObject({ severity: 'fault', data: { cause: 'streamUnreachable' } });
    });

    it('keeps the ordinary first-listener gap out of the feed entirely', () => {
        // Measured at ~500ms on the running station and designed behaviour: the app queues
        // nothing while the audience gate is shut. One line per listener arrival is the fastest
        // way to make a feed unreadable.
        const { service } = build();

        service.noteStarve({ state: 'starved', forMs: 0 });
        service.noteStarve({ state: 'recovered', forMs: 500 });

        expect(recorded()).not.toHaveBeenCalled();
    });

    it('records a gap that outlived the loop meant to close it, on the recovery', () => {
        const { service } = build();

        service.noteStarve({ state: 'recovered', forMs: 30_000 });

        expect(recorded()).toHaveBeenCalledOnce();
        expect(recorded().mock.calls[0]?.[0]).toMatchObject({ module: 'playout', kind: 'gap', severity: 'fault', data: { gapMs: 30_000 } });
    });
});

// The route the player fetches every record through. Whether the bytes were on disk, held in memory
// or pulled from the provider a moment ago is the service's business; what matters here is that the
// mime and the ETag come from the bytes actually being served, and that "nothing to serve" is a 404
// the player skips rather than an empty 200 it would air as a gap.
describe('PlayoutService.getTrackAudio', () => {
    const SOURCE_ID = '11111111-2222-3333-4444-555555555555';
    const CHECKSUM = 'a'.repeat(64);

    it('serves the bytes with the mime the player picks its decoder from', async () => {
        const body = Buffer.from('a record');
        const { service } = build({ trackAudio: { contentType: 'audio/ogg', body, checksum: CHECKSUM } });

        expect(await service.getTrackAudio(SOURCE_ID)).toEqual({
            contentType: 'audio/ogg',
            body,
            headers: { cacheControl: 'public, max-age=86400', etag: `"${CHECKSUM}"` },
        });
    });

    // No such binding, or a provider that would not serve it. Both are real absences now that the
    // route fetches for itself, so there is one answer for them.
    it('is a 404 when there is no audio to be had', async () => {
        const { service } = build({});

        expect(await statusOf(service.getTrackAudio(SOURCE_ID))).toBe(404);
    });
});
