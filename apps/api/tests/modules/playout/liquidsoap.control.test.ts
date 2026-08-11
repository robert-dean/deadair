// `parseReading` is the whole compatibility boundary between the app and the stream
// script. The app and the container deploy independently, so a running Liquidsoap may
// be on an older radio.liq that reports less — and every field this gets wrong is a
// confident lie about what the listener is hearing.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { parseReading, PlayoutControlClient } from '../../../src/modules/playout/liquidsoap.control.js';
import { annotateUri, itemAnnotations, ITEM_KEY } from '../../../src/modules/playout/annotate.js';
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
        expect(parseReading({ queued: 0, ready: false, onAir: '' }).onAir).toBeUndefined();
    });

    it('drops a non-positive remaining time', () => {
        // radio.liq sends -1 for "cannot say", but `remaining()` itself answers 0 for
        // a queue with nothing on air — so a 0 reaching here is not a measurement of
        // an item at all.
        expect(parseReading({ queued: 0, ready: true, onAir: 'x', remainingMs: -1 }).remainingMs).toBeUndefined();
        expect(parseReading({ queued: 0, ready: true, onAir: 'x', remainingMs: 0 }).remainingMs).toBeUndefined();
    });

    it('reads whether the station is actually on air', () => {
        expect(parseReading({ queued: 0, ready: true, driving: true }).driving).toBe(true);
        expect(parseReading({ queued: 0, ready: true, driving: false }).driving).toBe(false);
    });

    it('leaves `driving` unreported by a script too old to have a gate', () => {
        // Absent is not false: an older radio.liq has no lease at all, and the two
        // states need telling apart by whatever decides what to claim.
        expect(parseReading({ queued: 0, ready: true }).driving).toBeUndefined();
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

describe('itemAnnotations', () => {
    const item = {
        id: 'item-1',
        pluginId: 'deadair.spotify',
        externalId: 'trk_1',
        title: 'Windowlicker',
        artists: ['Aphex Twin', 'Someone Else'],
    };

    it('labels the mount with what the app knows, because the file cannot', () => {
        // Liquidsoap plays a file it fetched from a URL we handed it, and a Spotify
        // item carries no usable tags. These names are Liquidsoap's own, and
        // output.icecast builds the ICY stream title out of them.
        expect(itemAnnotations({ ...item, album: 'Windowlicker' })).toEqual({
            deadair_item: 'item-1',
            title: 'Windowlicker',
            artist: 'Aphex Twin, Someone Else',
            album: 'Windowlicker',
        });
    });

    it('still carries the id, which is the half the app reads back', () => {
        expect(itemAnnotations(item)[ITEM_KEY]).toBe('item-1');
    });

    it('omits what it does not know rather than sending it blank', () => {
        // An `artist=""` overwrites the file's own tags with nothing, and for a local
        // library those tags are better than silence on the mount.
        expect(itemAnnotations({ ...item, artists: [] })).toEqual({ deadair_item: 'item-1', title: 'Windowlicker' });
    });
});

describe('itemAnnotations: cue points', () => {
    const item = (extra: Record<string, unknown>) =>
        ({ id: 'item-1', pluginId: 'deadair.spotify', externalId: 'trk_1', title: 'A', artists: ['One'], ...extra }) as never;

    it('stamps the span the player should read, in seconds', () => {
        // Milliseconds everywhere in the app; Liquidsoap takes a float in seconds, and
        // this is the only place that conversion happens.
        const stamped = itemAnnotations(item({ cueInMs: 180, cueOutMs: 213_600 }));

        expect(stamped.liq_cue_in).toBe('0.18');
        expect(stamped.liq_cue_out).toBe('213.6');
    });

    it('leaves cue_in out when the record starts at zero', () => {
        // It is the default, so sending it says nothing -- and leaving it out keeps a
        // legitimately untrimmed record from looking measured in a queue reading.
        const stamped = itemAnnotations(item({ cueInMs: 0, cueOutMs: 213_600 }));

        expect(stamped).not.toHaveProperty('liq_cue_in');
        expect(stamped.liq_cue_out).toBe('213.6');
    });

    it('stamps nothing for an unmeasured track', () => {
        // The ordinary state. An unmeasured track has to play.
        const stamped = itemAnnotations(item({}));

        expect(stamped).not.toHaveProperty('liq_cue_in');
        expect(stamped).not.toHaveProperty('liq_cue_out');
    });

    it('stamps nothing when only one of the pair is present', () => {
        expect(itemAnnotations(item({ cueInMs: 180 }))).not.toHaveProperty('liq_cue_in');
        expect(itemAnnotations(item({ cueOutMs: 213_600 }))).not.toHaveProperty('liq_cue_out');
    });

    it('stamps nothing for a span that does not run forwards', () => {
        // The player would produce nothing for it, which is silence on air rather than
        // an error anybody sees.
        expect(itemAnnotations(item({ cueInMs: 9_000, cueOutMs: 9_000 }))).not.toHaveProperty('liq_cue_out');
        expect(itemAnnotations(item({ cueInMs: 9_000, cueOutMs: 8_000 }))).not.toHaveProperty('liq_cue_out');
        expect(itemAnnotations(item({ cueInMs: -1, cueOutMs: 8_000 }))).not.toHaveProperty('liq_cue_out');
    });

    it('survives the whole annotate round trip', () => {
        const uri = annotateUri(itemAnnotations(item({ cueInMs: 180, cueOutMs: 213_600 })), 'http://shim/track');

        expect(uri).toContain('liq_cue_in="0.18"');
        expect(uri).toContain('liq_cue_out="213.6"');
        expect(uri.endsWith(':http://shim/track')).toBe(true);
    });
});
