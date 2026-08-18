// `parseReading` is the whole compatibility boundary between the app and the stream
// script. The app and the container deploy independently, so a running Liquidsoap may
// be on an older radio.liq that reports less — and every field this gets wrong is a
// confident lie about what the listener is hearing.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { parseReading, PlayoutControlClient } from '../../../src/modules/playout/liquidsoap.control.js';
import { annotateUri, itemAnnotations, HARD_JOIN_MS, ITEM_KEY } from '../../../src/modules/playout/annotate.js';
import { RENDER_PLUGIN_ID } from '../../../src/modules/render/segment.source.js';
import { speechGainFor } from '../../../src/modules/playout/gain.js';
import { DEFAULT_SPEECH_TRIM_DB, DEFAULT_TARGET_LUFS } from '../../../src/modules/playout/gain.js';
import type { LiquidsoapEndpoint } from '../../../src/modules/playout/liquidsoap.endpoint.js';
import type { StreamConfigWatch } from '../../../src/modules/stream/stream.staleness.js';

describe('parseReading', () => {
    it('reads a full reading', () => {
        expect(parseReading({ queued: 1, ready: true, onAir: 'item-1', remainingMs: 92_500 })).toEqual({
            queued: 1,
            ready: true,
            onAir: 'item-1',
            remainingMs: 92_500,
        });
    });

    it('rejects a body with no queue depth at all', () => {
        // This is how a 401 page, or some unrelated service answering on the port,
        // is told apart from a reading. Everything downstream treats `undefined` as
        // "the stream is not up", which is the safe reading of both.
        expect(parseReading({ error: 'denied' })).toBeUndefined();
        expect(parseReading('denied')).toBeUndefined();
        expect(parseReading(undefined)).toBeUndefined();
    });

    it('keeps only the fields an older script omits, rather than inventing them', () => {
        // Absent must mean "not reported", never "zero": the rundown keys its whole
        // believe-nothing path off `ready` being missing.
        expect(parseReading({ queued: 0 })).toEqual({ queued: 0 });
    });

    it('treats an empty onAir as nothing playing, not as an id', () => {
        // radio.liq reports "" when the queue is not producing.
        expect(parseReading({ queued: 0, ready: false, onAir: '' })!.onAir).toBeUndefined();
    });

    it('drops a non-positive remaining time', () => {
        // radio.liq sends -1 for "cannot say", but `remaining()` itself answers 0 for
        // a queue with nothing on air — so a 0 reaching here is not a measurement of
        // an item at all.
        expect(parseReading({ queued: 0, ready: true, onAir: 'x', remainingMs: -1 })!.remainingMs).toBeUndefined();
        expect(parseReading({ queued: 0, ready: true, onAir: 'x', remainingMs: 0 })!.remainingMs).toBeUndefined();
    });

    it('reads whether the station is actually on air', () => {
        expect(parseReading({ queued: 0, ready: true, driving: true })!.driving).toBe(true);
        expect(parseReading({ queued: 0, ready: true, driving: false })!.driving).toBe(false);
    });

    it('leaves `driving` unreported by a script too old to have a gate', () => {
        // Absent is not false: an older radio.liq has no lease at all, and the two
        // states need telling apart by whatever decides what to claim.
        expect(parseReading({ queued: 0, ready: true })!.driving).toBeUndefined();
    });

    it('ignores a malformed field instead of failing the whole reading', () => {
        const reading = parseReading({ queued: 2, ready: 'yes', onAir: 42, remainingMs: 'soon' });

        expect(reading).toEqual({ queued: 2 });
    });
});

describe('PlayoutControlClient.isUp', () => {
    // The console shows this as "the stream is not reachable, so nothing can go to
    // air". It has to mean a call that actually happened: the endpoint returns a
    // configured LIQUIDSOAP_CONTROL_URL without probing it, so anything derived from
    // resolution alone would report a dead stream as up the moment one is pinned.
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

    /** An endpoint that always hands back an address, exactly as a pinned override does. */
    const pinnedEndpoint = {
        resolve: async () => 'http://stream.test:8005',
        secret: () => 'a-secret',
        invalidate: vi.fn(),
    } as unknown as LiquidsoapEndpoint;

    /** The drift watch is fed by every reading and consulted by none of them; see stream.staleness.ts. */
    const staleness = { noteLiquidsoap: vi.fn() } as unknown as StreamConfigWatch;

    const clientWith = (fetchImpl: typeof fetch) => {
        vi.stubGlobal('fetch', fetchImpl);
        return new PlayoutControlClient(pinnedEndpoint, staleness, logger);
    };

    // The endpoint is shared by every case here, so its calls are too. The timeout cases below
    // assert on what was NOT invalidated, which without this reads whatever an earlier case did.
    beforeEach(() => {
        vi.mocked(pinnedEndpoint.invalidate).mockClear();
    });

    it('is false before anything has been heard from', () => {
        const client = new PlayoutControlClient(pinnedEndpoint, staleness, logger);

        expect(client.isUp()).toBe(false);
    });

    it('is true once a call is answered', async () => {
        const client = clientWith(async () => new Response(JSON.stringify({ queued: 0, ready: false }), { status: 200 }));
        try {
            await client.status();
            expect(client.isUp()).toBe(true);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('is false when the address is pinned but nothing is listening', async () => {
        // The case that made this exist. The endpoint resolves happily; the socket does not.
        const client = clientWith(async () => {
            throw new Error('connect ECONNREFUSED');
        });
        try {
            await client.status();
            expect(client.isUp()).toBe(false);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('stays up when the stream answers but refuses', async () => {
        // A 401 means the secret diverged. Something is there, and telling the operator
        // the stream is unreachable would send them looking for the wrong fault.
        const client = clientWith(async () => new Response('denied', { status: 401 }));
        try {
            expect(await client.status()).toBeUndefined();
            expect(client.isUp()).toBe(true);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    /**
     * A timeout is a BUSY engine, not a dead one, and the difference is the whole reason the
     * station used to go quiet for twenty seconds at a time. Measured against the real container:
     * the harbor dispatches at a p50 of 192ms and a peak of 1.6s while playing nothing, so a call
     * going over budget says the engine is working, not that it has gone away.
     */
    const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

    it('stays up through a single timeout, and keeps the address it had', async () => {
        // What this used to cost: `up` went false, the address was dropped, the next call had to
        // re-probe, and nothing renewed the lease while it did — so a slow answer became a mount
        // falling through to the local bed.
        const client = clientWith(async () => {
            throw timeout();
        });
        try {
            await client.status();

            expect(client.isUp()).toBe(false);
            expect(pinnedEndpoint.invalidate).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('keeps a station that answered once up through a slow call', async () => {
        let slow = false;
        const client = clientWith(async () => {
            if (slow) throw timeout();
            return new Response(JSON.stringify({ queued: 0, ready: false }), { status: 200 });
        });
        try {
            await client.status();
            expect(client.isUp()).toBe(true);

            slow = true;
            await client.status();
            expect(client.isUp()).toBe(true);
            expect(pinnedEndpoint.invalidate).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('gives up after a run of them, so a hung engine does not read as healthy forever', async () => {
        const client = clientWith(async () => {
            throw timeout();
        });
        try {
            await client.status();
            await client.status();
            expect(client.isUp()).toBe(false);

            await client.status();
            expect(pinnedEndpoint.invalidate).toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('forgets the run as soon as anything answers', async () => {
        // Two slow calls and a good one is a busy engine, not a failing one. Without the reset,
        // timeouts spread over an hour would eventually add up to a stream declared dead.
        let slow = true;
        const client = clientWith(async () => {
            if (slow) throw timeout();
            return new Response(JSON.stringify({ queued: 0, ready: false }), { status: 200 });
        });
        try {
            await client.status();
            await client.status();
            slow = false;
            await client.status();
            slow = true;
            await client.status();
            await client.status();

            expect(pinnedEndpoint.invalidate).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('goes down at once when the connection is refused, which is a real absence', async () => {
        // The case the invalidate was written for, and the one it must keep: a refused socket
        // fails in milliseconds and means the container is gone, not busy.
        const client = clientWith(async () => {
            throw new Error('connect ECONNREFUSED');
        });
        try {
            await client.status();

            expect(client.isUp()).toBe(false);
            expect(pinnedEndpoint.invalidate).toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('goes back down after a call fails', async () => {
        let answer = true;
        const client = clientWith(async () => {
            if (!answer) throw new Error('gone');
            return new Response(JSON.stringify({ queued: 0, ready: false }), { status: 200 });
        });
        try {
            await client.status();
            expect(client.isUp()).toBe(true);

            answer = false;
            await client.status();
            expect(client.isUp()).toBe(false);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe('PlayoutControlClient mutations', () => {
    // Every /control/* endpoint answers with the same reading as /control/status, so
    // a mutation's own response is already the state it produced. Throwing that away
    // and going back to ask is a round trip, and a round trip is a boundary missed.
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

    const pinnedEndpoint = {
        resolve: async () => 'http://stream.test:8005',
        secret: () => 'a-secret',
        invalidate: vi.fn(),
    } as unknown as LiquidsoapEndpoint;

    /** The drift watch is fed by every reading and consulted by none of them; see stream.staleness.ts. */
    const staleness = { noteLiquidsoap: vi.fn() } as unknown as StreamConfigWatch;

    const clientWith = (fetchImpl: typeof fetch) => {
        vi.stubGlobal('fetch', fetchImpl);
        return new PlayoutControlClient(pinnedEndpoint, staleness, logger);
    };

    it('answers a skip with the reading the command produced', async () => {
        const client = clientWith(
            async () => new Response(JSON.stringify({ queued: 0, ready: true, onAir: 'item-2', remainingMs: 1000 }), { status: 200 }),
        );
        try {
            expect(await client.skip()).toEqual({ queued: 0, ready: true, onAir: 'item-2', remainingMs: 1000 });
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('answers a flush the same way', async () => {
        const client = clientWith(async () => new Response(JSON.stringify({ queued: 0, ready: false, onAir: '' }), { status: 200 }));
        try {
            expect(await client.flush()).toEqual({ queued: 0, ready: false });
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('remembers whether the station is on air, and forgets it when the stream goes', async () => {
        // isOnAir has to be answerable without a round trip, because getStatus is
        // polled — and it must not go stale into a claim that the station is
        // broadcasting when nothing has answered since.
        let driving = true;
        const client = clientWith(async () => {
            if (!driving) throw new Error('gone');
            return new Response(JSON.stringify({ queued: 0, ready: true, driving: true }), { status: 200 });
        });
        try {
            expect(client.isOnAir()).toBe(false);

            await client.status();
            expect(client.isOnAir()).toBe(true);

            driving = false;
            await client.status();
            expect(client.isOnAir()).toBe(false);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('does not claim to be on air against a script that cannot say', async () => {
        // An older radio.liq reports no `driving` at all. Silence on the question is
        // not a yes: a console that cannot confirm must not claim.
        const client = clientWith(async () => new Response(JSON.stringify({ queued: 1, ready: true }), { status: 200 }));
        try {
            await client.status();
            expect(client.isOnAir()).toBe(false);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('answers undefined when the stream did not take the command', async () => {
        // Which is what the caller reads as "the skip did not happen": the same
        // treatment a body that is not a reading gets, because a 401 page and an
        // unreachable socket are equally not a confirmation.
        const client = clientWith(async () => new Response('denied', { status: 401 }));
        try {
            expect(await client.skip()).toBeUndefined();
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe('annotateUri', () => {
    it('wraps a uri so the item id survives the round trip through Liquidsoap', () => {
        expect(annotateUri({ [ITEM_KEY]: 'item-1' }, 'https://example.test/a.ogg')).toBe('annotate:deadair_item="item-1":https://example.test/a.ogg');
    });

    it('leaves a signed URL untouched: its own colons and query string must survive', () => {
        // The value is quoted, so the uri after the final colon is passed through whole.
        // A shim URL carries `?t=<signature>`, and mangling it fails on air.
        const uri = 'http://127.0.0.1:3679/track/abc?t=1234.sig-with-colons:in-it';

        expect(annotateUri({ [ITEM_KEY]: 'item-1' }, uri)).toBe(`annotate:deadair_item="item-1":${uri}`);
    });

    it('escapes quotes and backslashes in a value', () => {
        expect(annotateUri({ [ITEM_KEY]: 'a"b\\c' }, 'file:///x.mp3')).toBe('annotate:deadair_item="a\\"b\\\\c":file:///x.mp3');
    });

    it('returns the bare uri when there is nothing to annotate', () => {
        expect(annotateUri({}, 'file:///x.mp3')).toBe('file:///x.mp3');
    });
});

/** The station's target, for the cases that are not about levels at all. */
// No successor and no blending: the boundary annotations are inert, which keeps every
// test below about the thing it is named for. The blend has its own block at the end.
const CONTEXT = { targetLufs: DEFAULT_TARGET_LUFS, speechTrimDb: DEFAULT_SPEECH_TRIM_DB, crossfade: false };

/** What a boundary the station does not blend is stamped with, as it reaches the player. */
const HARD_JOIN = String(HARD_JOIN_MS / 1000);

describe('itemAnnotations', () => {
    const item = {
        id: 'item-1',
        pluginId: 'deadair.spotify',
        externalId: 'trk_1',
        title: 'Windowlicker',
        artists: ['Aphex Twin', 'Someone Else'],
        artist: 'Aphex Twin',
    };

    it('labels the mount with what the app knows, because the file cannot', () => {
        // Liquidsoap plays a file it fetched from a URL we handed it, and a Spotify
        // item carries no usable tags. These names are Liquidsoap's own, and
        // output.icecast builds the ICY stream title out of them.
        expect(itemAnnotations({ ...item, album: 'Windowlicker' }, CONTEXT)).toEqual({
            deadair_item: 'item-1',
            title: 'Windowlicker',
            artist: 'Aphex Twin, Someone Else',
            album: 'Windowlicker',
            // Both ends always present. See the blend block below for why there are two.
            liq_cross_end_duration: HARD_JOIN,
            liq_cross_start_duration: HARD_JOIN,
        });
    });

    it('still carries the id, which is the half the app reads back', () => {
        expect(itemAnnotations(item, CONTEXT)[ITEM_KEY]).toBe('item-1');
    });

    it('omits what it does not know rather than sending it blank', () => {
        // An `artist=""` overwrites the file's own tags with nothing, and for a local
        // library those tags are better than silence on the mount.
        expect(itemAnnotations({ ...item, artists: [] }, CONTEXT)).toEqual({
            deadair_item: 'item-1',
            title: 'Windowlicker',
            liq_cross_end_duration: HARD_JOIN,
            liq_cross_start_duration: HARD_JOIN,
        });
    });
});

describe('itemAnnotations: cue points', () => {
    const item = (extra: Record<string, unknown>) =>
        ({ id: 'item-1', pluginId: 'deadair.spotify', externalId: 'trk_1', title: 'A', artists: ['One'], ...extra }) as never;

    it('stamps the span the player should read, in seconds', () => {
        // Milliseconds everywhere in the app; Liquidsoap takes a float in seconds, and
        // this is the only place that conversion happens.
        const stamped = itemAnnotations(item({ cueInMs: 180, cueOutMs: 213_600 }), CONTEXT);

        expect(stamped.liq_cue_in).toBe('0.18');
        expect(stamped.liq_cue_out).toBe('213.6');
    });

    it('leaves cue_in out when the record starts at zero', () => {
        // It is the default, so sending it says nothing -- and leaving it out keeps a
        // legitimately untrimmed record from looking measured in a queue reading.
        const stamped = itemAnnotations(item({ cueInMs: 0, cueOutMs: 213_600 }), CONTEXT);

        expect(stamped).not.toHaveProperty('liq_cue_in');
        expect(stamped.liq_cue_out).toBe('213.6');
    });

    it('stamps nothing for an unmeasured track', () => {
        // The ordinary state. An unmeasured track has to play.
        const stamped = itemAnnotations(item({}), CONTEXT);

        expect(stamped).not.toHaveProperty('liq_cue_in');
        expect(stamped).not.toHaveProperty('liq_cue_out');
    });

    it('stamps nothing when only one of the pair is present', () => {
        expect(itemAnnotations(item({ cueInMs: 180 }), CONTEXT)).not.toHaveProperty('liq_cue_in');
        expect(itemAnnotations(item({ cueOutMs: 213_600 }), CONTEXT)).not.toHaveProperty('liq_cue_out');
    });

    it('stamps nothing for a span that does not run forwards', () => {
        // The player would produce nothing for it, which is silence on air rather than
        // an error anybody sees.
        expect(itemAnnotations(item({ cueInMs: 9_000, cueOutMs: 9_000 }), CONTEXT)).not.toHaveProperty('liq_cue_out');
        expect(itemAnnotations(item({ cueInMs: 9_000, cueOutMs: 8_000 }), CONTEXT)).not.toHaveProperty('liq_cue_out');
        expect(itemAnnotations(item({ cueInMs: -1, cueOutMs: 8_000 }), CONTEXT)).not.toHaveProperty('liq_cue_out');
    });

    it('survives the whole annotate round trip', () => {
        const uri = annotateUri(itemAnnotations(item({ cueInMs: 180, cueOutMs: 213_600 }), CONTEXT), 'http://shim/track');

        expect(uri).toContain('liq_cue_in="0.18"');
        expect(uri).toContain('liq_cue_out="213.6"');
        expect(uri.endsWith(':http://shim/track')).toBe(true);
    });
});

describe('itemAnnotations: gain', () => {
    const item = (extra: Record<string, unknown>) =>
        ({ id: 'item-1', pluginId: 'deadair.spotify', externalId: 'trk_1', title: 'A', artists: ['One'], ...extra }) as never;

    it('always carries the dB suffix', () => {
        // The one thing in this file that cannot be got wrong quietly. Liquidsoap parses
        // the value as `sscanf " %f dB"` and falls back to `float_of_string`, so a bare
        // "-3" is not a quiet record: it is a linear factor of minus three, which is the
        // audio inverted and amplified tenfold.
        const stamped = itemAnnotations(item({ loudnessLufs: -19, truePeakDb: -6 }), CONTEXT);

        expect(stamped.liq_amplify).toBe('3 dB');
        expect(itemAnnotations(item({ loudnessLufs: -11, truePeakDb: -0.5 }), CONTEXT).liq_amplify).toBe('-5 dB');
    });

    it('stamps a tenth of a decibel readably', () => {
        expect(itemAnnotations(item({ loudnessLufs: -18.4, truePeakDb: -6 }), CONTEXT).liq_amplify).toBe('2.4 dB');
    });

    it('stamps nothing for an unmeasured track', () => {
        // The ordinary state, and the one that must never look like a fault.
        expect(itemAnnotations(item({}), CONTEXT)).not.toHaveProperty('liq_amplify');
    });

    it('stamps nothing for a record already at the target', () => {
        expect(itemAnnotations(item({ loudnessLufs: -16.2, truePeakDb: -3 }), CONTEXT)).not.toHaveProperty('liq_amplify');
    });

    it('follows the station target rather than a constant', () => {
        // Read per hand-over from `deadair.settings`, so this is what an operator moving
        // it actually changes.
        expect(
            itemAnnotations(item({ loudnessLufs: -20, truePeakDb: -9 }), { targetLufs: -14, speechTrimDb: DEFAULT_SPEECH_TRIM_DB, crossfade: false })
                .liq_amplify,
        ).toBe('6 dB');
        expect(
            itemAnnotations(item({ loudnessLufs: -20, truePeakDb: -9 }), { targetLufs: -23, speechTrimDb: DEFAULT_SPEECH_TRIM_DB, crossfade: false })
                .liq_amplify,
        ).toBe('-3 dB');
    });

    it('rides the annotate uri alongside the cue points', () => {
        const uri = annotateUri(
            itemAnnotations(item({ cueInMs: 180, cueOutMs: 213_600, loudnessLufs: -19, truePeakDb: -6 }), CONTEXT),
            'http://shim/track',
        );

        expect(uri).toContain('liq_amplify="3 dB"');
        expect(uri).toContain('liq_cue_out="213.6"');
    });
});

// A break aired BETWEEN two records is an ordinary running-order item -- it goes down the playout
// queue, through the same annotations, and never touches the mic chain that the talk-over path's
// `VOICE_GAIN_DB` sits in. It is the half that had nothing holding its level at all.
describe('itemAnnotations: a break the station spoke', () => {
    const segment = (extra: Record<string, unknown> = {}) =>
        ({ id: 'item-1', pluginId: RENDER_PLUGIN_ID, externalId: 'seg_1', title: 'Talk break', artists: [], ...extra }) as never;

    it('stamps an unmeasured break rather than leaving it where the engine put it', () => {
        // The opposite call from the unmeasured RECORD above, and the reason the two are
        // separate functions: nothing else in the graph will lift this.
        expect(itemAnnotations(segment(), CONTEXT).liq_amplify).toBe(`${speechGainFor({}, -16, DEFAULT_SPEECH_TRIM_DB)} dB`);
    });

    it('stamps every break, including one that needs nothing', () => {
        // No dead band: an unstamped push would leave the previous break's override standing.
        expect(itemAnnotations(segment({ loudnessLufs: -18 }), CONTEXT).liq_amplify).toBe('0 dB');
    });

    it('uses the measurement when the segment carries one', () => {
        expect(itemAnnotations(segment({ loudnessLufs: -22 }), CONTEXT).liq_amplify).toBe('4 dB');
    });

    it('marks a break as the station talking, and marks no record', () => {
        // The mixer reads this to switch its compressor on for the item: the playout queue carries
        // records and breaks down one chain, and the settings that tame a plosive would pump a
        // record. Absent and false have to be the same answer on the Liquidsoap side.
        expect(itemAnnotations(segment(), CONTEXT).deadair_speech).toBe('1');
        const track = { id: 'item-2', pluginId: 'deadair.spotify', externalId: 'trk_1', title: 'A', artists: ['One'] } as never;
        expect(itemAnnotations(track, CONTEXT).deadair_speech).toBeUndefined();
    });

    it('is not capped by the peak the way a record is', () => {
        expect(itemAnnotations(segment({ loudnessLufs: -26, truePeakDb: -9 }), CONTEXT).liq_amplify).toBe('8 dB');
    });
});

describe('itemAnnotations: the blend', () => {
    const measured = (id: string, extra: Record<string, unknown> = {}) =>
        ({
            id,
            pluginId: 'deadair.spotify',
            externalId: 'trk_1',
            title: 'A',
            artists: ['One'],
            cueInMs: 0,
            introEndMs: 8_000,
            outroStartMs: 190_000,
            cueOutMs: 200_000,
            ...extra,
        }) as never;

    it('stamps the overlap in seconds, on the record that is ending', () => {
        // `cross` reads the end override off the track whose end it is buffering, so the
        // duration for a boundary lives on the OUTGOING item -- even though its value
        // came from measuring both.
        const stamped = itemAnnotations(measured('item-1'), {
            targetLufs: DEFAULT_TARGET_LUFS,
            speechTrimDb: DEFAULT_SPEECH_TRIM_DB,
            crossfade: true,
            next: measured('item-2'),
        });

        // min(outro 10s, intro 8s).
        expect(stamped.liq_cross_end_duration).toBe('8');
    });

    it('always stamps, because the override persists', () => {
        // The one line in `annotate.ts` that looks defensive and is not. `cross` needs
        // `persist_override=true` on 2.4, and the flip side is that a stamp lingers over
        // every later unstamped track -- so an item without one would not be a hard join,
        // it would be a blend by whatever the last measured record left behind.
        expect(itemAnnotations(measured('item-1'), CONTEXT).liq_cross_end_duration).toBe(HARD_JOIN);
        expect(itemAnnotations(measured('item-1', { cueInMs: undefined }), CONTEXT).liq_cross_end_duration).toBe(HARD_JOIN);
    });

    it('never stamps a zero, which would stop the operator rather than skip the blend', () => {
        // A `cross` sized at zero never appends a frame, so it never sees the end of the
        // track and never advances past buffering: the source it hands out is never
        // ready and the station falls to the local bed for good. The station's own word
        // for no blend is zero; the engine's is a tenth of a second.
        const every = [
            itemAnnotations(measured('item-1'), CONTEXT),
            itemAnnotations(measured('item-1'), { targetLufs: DEFAULT_TARGET_LUFS, speechTrimDb: DEFAULT_SPEECH_TRIM_DB, crossfade: true }),
            itemAnnotations(measured('item-1', { introEndMs: undefined }), {
                targetLufs: DEFAULT_TARGET_LUFS,
                speechTrimDb: DEFAULT_SPEECH_TRIM_DB,
                crossfade: true,
                next: measured('item-2'),
            }),
        ];

        for (const stamped of every) expect(Number(stamped.liq_cross_end_duration)).toBeGreaterThan(0);
    });

    it('does not blend when the broadcast does not', () => {
        // An album, or a sequenced setlist. Its gaps are somebody's decision.
        const context = { targetLufs: DEFAULT_TARGET_LUFS, speechTrimDb: DEFAULT_SPEECH_TRIM_DB, crossfade: false, next: measured('item-2') };

        expect(itemAnnotations(measured('item-1'), context).liq_cross_end_duration).toBe(HARD_JOIN);
    });

    it('does not blend into nothing', () => {
        // The tail of what has been planned. Nothing follows, so there is no boundary.
        expect(
            itemAnnotations(measured('item-1'), { targetLufs: DEFAULT_TARGET_LUFS, speechTrimDb: DEFAULT_SPEECH_TRIM_DB, crossfade: true })
                .liq_cross_end_duration,
        ).toBe(HARD_JOIN);
    });

    it('rides the annotate uri alongside everything else', () => {
        const uri = annotateUri(
            itemAnnotations(measured('item-1', { loudnessLufs: -19, truePeakDb: -6 }), {
                targetLufs: DEFAULT_TARGET_LUFS,
                speechTrimDb: DEFAULT_SPEECH_TRIM_DB,
                crossfade: true,
                next: measured('item-2'),
            }),
            'http://shim/track',
        );

        expect(uri).toContain('liq_cross_end_duration="8"');
        expect(uri).toContain('liq_cue_out="200"');
        expect(uri).toContain('liq_amplify="3 dB"');
    });
});

describe('PlayoutControlClient.starvedSince', () => {
    // A gap on the mount is the one state the app cannot observe for itself: the
    // reconcile loop looks every couple of seconds, so anything shorter never appears in
    // a reading at all. Liquidsoap pushes it, and it is kept here because it is a fact
    // about the player and because everything else that holds one is a singleton.
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
    const endpoint = {
        resolve: async () => 'http://stream.test:8005',
        secret: () => 'a-secret',
        invalidate: vi.fn(),
    } as unknown as LiquidsoapEndpoint;
    const staleness = { noteLiquidsoap: vi.fn() } as unknown as StreamConfigWatch;
    const client = () => new PlayoutControlClient(endpoint, staleness, logger);

    it('is absent on a station that has never starved', () => {
        expect(client().starvedSince()).toBeUndefined();
    });

    it('remembers when the gap opened', () => {
        const control = client();
        control.noteStarve(true, 1_000);

        expect(control.starvedSince()).toBe(1_000);
    });

    it('keeps the original edge when the state is repeated', () => {
        // The stream reports the state rather than strictly alternating edges, and what
        // is worth reading is how long the mount has been on the bed rather than how long
        // since the last message about it.
        const control = client();
        control.noteStarve(true, 1_000);
        control.noteStarve(true, 9_000);

        expect(control.starvedSince()).toBe(1_000);
    });

    it('clears on recovery', () => {
        const control = client();
        control.noteStarve(true, 1_000);
        control.noteStarve(false, 4_000);

        expect(control.starvedSince()).toBeUndefined();
    });

    it('reopens after a recovery', () => {
        const control = client();
        control.noteStarve(true, 1_000);
        control.noteStarve(false, 4_000);
        control.noteStarve(true, 8_000);

        expect(control.starvedSince()).toBe(8_000);
    });
});
