// The one place audio for a record comes from, so this file is where the four sources have to be told
// apart: the file on disk, the in-memory hold, a fetch already running, and the provider. Two of them
// only exist because the station may be keeping nothing — the switch decides what happens to bytes
// AFTER they arrive, never whether the record can be played.

import { readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Container } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_TRACK_BYTES, TrackAudioService } from '../../../../src/modules/playout/audio/track.audio.service.js';
import { TrackAudioRepository, type SourceAudio } from '../../../../src/modules/playout/audio/track.audio.repository.js';
import { TrackStore } from '../../../../src/modules/playout/audio/track.store.js';
import { TRACK_CACHE_KEY } from '../../../../src/modules/playout/audio/track.cache.settings.js';
import type { PluginTrackResolver } from '../../../../src/modules/playout/providers/plugin.resolver.js';
import { TracksRepository } from '../../../../src/modules/catalog/tracks.repository.js';

const SOURCE_ID = '11111111-2222-3333-4444-555555555555';
const AUDIO_URL = 'http://127.0.0.1:3679/track/track-42?t=signed';

/** Comfortably over the floor, so the size guards are not what most of these tests are about. */
const RECORD = Buffer.alloc(32 * 1024, 7);

const BINDING: SourceAudio = { sourceId: SOURCE_ID, pluginId: 'deadair.spotify', externalId: 'track-42', attempts: 0 };

let root: string;
let store: TrackStore;

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() } as unknown as Logger;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deadair-track-audio-test-'));
    store = new TrackStore(root);
});

afterEach(async () => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    await rm(root, { recursive: true, force: true });
});

/**
 * A service over a real store and a fake everything-else.
 *
 * `keeping` is `playout.trackCache`: on means fetched bytes are written under TRACKS_DIR, off means
 * they go into the in-memory hold. No default on `source`, because "the catalog does not know this
 * binding" is one of the cases here and a default would quietly turn it into the happy path.
 */
const build = (options: { source: SourceAudio | undefined; keeping?: boolean; url?: string }) => {
    const findForSource = vi.fn(async () => options.source);
    const recordSuccess = vi.fn(async () => {});
    const recordFailure = vi.fn(async () => {});
    const markBindingMissing = vi.fn(async () => true);
    const disposeAsync = vi.fn(async () => {});

    const container = {
        createScopedContainer: () => ({
            get: (token: unknown) =>
                token === TrackAudioRepository
                    ? { findForSource, recordSuccess, recordFailure }
                    : token === TracksRepository
                      ? { markBindingMissing }
                      : undefined,
            disposeAsync,
        }),
    } as unknown as Container;

    const resolveBinding = vi.fn(async () => options.url ?? AUDIO_URL);
    const resolver = { resolveBinding } as unknown as PluginTrackResolver;

    const config = {
        get: (key: string, fallback: unknown) => (key === TRACK_CACHE_KEY ? String(options.keeping ?? true) : fallback),
    } as unknown as AppConfig;

    return {
        service: new TrackAudioService(container, store, resolver, config, logger),
        findForSource,
        recordSuccess,
        recordFailure,
        markBindingMissing,
        resolveBinding,
    };
};

const respondWith = (body: Buffer | undefined, init: { status?: number; contentType?: string } = {}): ReturnType<typeof vi.fn> => {
    const stub = vi.fn(async () => {
        const headers = new Headers(init.contentType === undefined ? {} : { 'content-type': init.contentType });
        return new Response(body === undefined ? null : new Uint8Array(body), { status: init.status ?? 200, headers });
    });
    vi.stubGlobal('fetch', stub);

    return stub;
};

/** Every file the store holds, temp files included, so a failed write leaving a prefix behind shows up. */
const filesOnDisk = async (): Promise<string[]> => {
    const entries = await readdir(root, { recursive: true, withFileTypes: true });

    return entries.filter(entry => entry.isFile()).map(entry => entry.name);
};

describe('TrackAudioService.ensure', () => {
    it('serves the file when the station already holds the record', async () => {
        const checksum = await store.write(RECORD, 'ogg');
        const { service, resolveBinding } = build({ source: { ...BINDING, checksum, ext: 'ogg' } });
        respondWith(RECORD, { contentType: 'audio/ogg' });

        expect(await service.ensure(SOURCE_ID)).toEqual({ contentType: 'audio/ogg', body: RECORD, checksum });
        expect(resolveBinding).not.toHaveBeenCalled();
    });

    // The point of the reshape: a record nobody has fetched is still playable, on the spot.
    it('fetches from the provider when nothing local has the record', async () => {
        const { service, recordSuccess } = build({ source: BINDING });
        respondWith(RECORD, { contentType: 'audio/mpeg' });

        const served = await service.ensure(SOURCE_ID);

        expect(served?.body).toEqual(RECORD);
        expect(served?.contentType).toBe('audio/mpeg');
        expect(await store.read(served!.checksum, 'mp3')).toEqual(RECORD);
        expect(recordSuccess).toHaveBeenCalledWith(SOURCE_ID, {
            checksum: served!.checksum,
            ext: 'mp3',
            contentType: 'audio/mpeg',
            byteSize: RECORD.byteLength,
        });
    });

    it('reads the extension off the content type, parameters and all', async () => {
        const { service, recordSuccess } = build({ source: BINDING });
        respondWith(RECORD, { contentType: 'AUDIO/X-FLAC; charset=binary' });

        await service.ensure(SOURCE_ID);

        expect(recordSuccess).toHaveBeenCalledWith(SOURCE_ID, expect.objectContaining({ ext: 'flac', contentType: 'audio/x-flac' }));
    });

    describe('with playout.trackCache off', () => {
        it('serves the record without writing anything to disk', async () => {
            const { service, recordSuccess } = build({ source: BINDING, keeping: false });
            respondWith(RECORD, { contentType: 'audio/ogg' });

            const served = await service.ensure(SOURCE_ID);

            expect(served?.body).toEqual(RECORD);
            expect(await filesOnDisk()).toEqual([]);
            // The bookkeeping half is still written: a fetch that worked has to clear the backoff and
            // the attempt count whether or not the bytes were kept.
            expect(recordSuccess).toHaveBeenCalledWith(SOURCE_ID, undefined);
        });

        // What makes "preload" still mean something with the switch off: the ripener's fetch is what
        // the request a minute later is served from.
        it('serves a held record without asking the provider again', async () => {
            const { service, resolveBinding } = build({ source: BINDING, keeping: false });
            respondWith(RECORD, { contentType: 'audio/ogg' });

            await service.warm(SOURCE_ID);
            const served = await service.ensure(SOURCE_ID);

            expect(served?.body).toEqual(RECORD);
            expect(resolveBinding).toHaveBeenCalledTimes(1);
        });

        // An ETag has to be real with the switch off too, or a conditional GET revalidates against
        // nothing. The hold hashes the bytes itself, since no store did it.
        it('answers with a checksum of the bytes it is holding', async () => {
            const onDisk = await store.write(RECORD, 'ogg');
            const { service } = build({ source: BINDING, keeping: false });
            respondWith(RECORD, { contentType: 'audio/ogg' });

            const served = await service.ensure(SOURCE_ID);

            expect(served?.checksum).toBe(onDisk);
        });
    });

    // Two things wanting one record at once: a MAX_HAND_OVERS retry landing mid-download, or the
    // ripener racing the request it was meant to spare. One download, both callers served.
    it('coalesces concurrent requests into one provider fetch', async () => {
        const { service, resolveBinding } = build({ source: BINDING });
        respondWith(RECORD, { contentType: 'audio/ogg' });

        const [first, second] = await Promise.all([service.ensure(SOURCE_ID), service.ensure(SOURCE_ID)]);

        expect(first?.body).toEqual(RECORD);
        expect(second?.body).toEqual(RECORD);
        expect(resolveBinding).toHaveBeenCalledTimes(1);
    });

    it('reports a fetch in flight, so the ripener does not queue a second', async () => {
        const { service } = build({ source: BINDING });
        respondWith(RECORD, { contentType: 'audio/ogg' });

        const pending = service.ensure(SOURCE_ID);
        expect(service.isFetching(SOURCE_ID)).toBe(true);

        await pending;
        expect(service.isFetching(SOURCE_ID)).toBe(false);
    });

    // A row claiming bytes the disk does not have — an emptied TRACKS_DIR, a half-restored backup.
    // Re-fetching repairs it; a 404 would skip a record the station can perfectly well fetch again.
    it('re-fetches when the row claims a file that is gone', async () => {
        const { service, resolveBinding } = build({ source: { ...BINDING, checksum: 'a'.repeat(64), ext: 'ogg' } });
        respondWith(RECORD, { contentType: 'audio/ogg' });

        const served = await service.ensure(SOURCE_ID);

        expect(served?.body).toEqual(RECORD);
        expect(resolveBinding).toHaveBeenCalledTimes(1);
    });

    it('has nothing to serve when the catalog does not know the binding', async () => {
        const { service, recordFailure } = build({ source: undefined });
        const stub = respondWith(RECORD, { contentType: 'audio/ogg' });

        expect(await service.ensure(SOURCE_ID)).toBeUndefined();
        expect(stub).not.toHaveBeenCalled();
        expect(recordFailure).not.toHaveBeenCalled();
    });

    it.each([
        ['a provider that will not mint a url', { url: '' }, () => respondWith(RECORD, { contentType: 'audio/mpeg' })],
        ['an upstream that answered 502', {}, () => respondWith(RECORD, { status: 502, contentType: 'audio/mpeg' })],
        ['an error page served as a 200', {}, () => respondWith(Buffer.from('<html>nope</html>'), { contentType: 'text/html' })],
        ['a response with no content type at all', {}, () => respondWith(RECORD)],
        ['a body too short to be a record', {}, () => respondWith(Buffer.from('unauthorized'), { contentType: 'audio/mpeg' })],
    ])('records %s as a failure and serves nothing', async (_, overrides, respond) => {
        const { service, recordFailure, recordSuccess } = build({ source: BINDING, ...overrides });
        respond();

        expect(await service.ensure(SOURCE_ID)).toBeUndefined();
        expect(recordFailure).toHaveBeenCalledWith(SOURCE_ID, expect.any(String), expect.any(Number), expect.any(Number));
        expect(recordSuccess).not.toHaveBeenCalled();
    });

    it('refuses a url a plugin minted for something that is not http', async () => {
        const { service, recordFailure } = build({ source: BINDING, url: 'file:///etc/passwd' });
        const stub = respondWith(RECORD, { contentType: 'audio/mpeg' });

        expect(await service.ensure(SOURCE_ID)).toBeUndefined();
        expect(recordFailure).toHaveBeenCalledWith(
            SOURCE_ID,
            expect.stringMatching(/refusing to fetch file:/),
            expect.any(Number),
            expect.any(Number),
        );
        expect(stub).not.toHaveBeenCalled();
    });

    // A truncated record would air as a song that stops mid-verse. Nothing is served and nothing is
    // left behind — no file under a name claiming to be the whole record, and no temp file either.
    it('serves and stores nothing when the body runs over the cap', async () => {
        const { service, recordFailure } = build({ source: BINDING });
        respondWith(Buffer.alloc(MAX_TRACK_BYTES + 1024, 3), { contentType: 'audio/flac' });

        expect(await service.ensure(SOURCE_ID)).toBeUndefined();
        expect(recordFailure).toHaveBeenCalledWith(SOURCE_ID, expect.stringContaining('larger than'), expect.any(Number), expect.any(Number));
        expect(await filesOnDisk()).toEqual([]);
    });
});

describe('TrackAudioService.warm', () => {
    it('gets the record in hand and says so', async () => {
        const { service } = build({ source: BINDING });
        respondWith(RECORD, { contentType: 'audio/ogg' });

        expect(await service.warm(SOURCE_ID)).toBe(true);
        expect(await filesOnDisk()).toHaveLength(1);
    });

    // A warm that fails must not fail its job: the request that actually needs the record will try
    // again, and the failure is already on the row.
    it('answers false rather than throwing when the record cannot be had', async () => {
        const { service, recordFailure } = build({ source: BINDING });
        respondWith(RECORD, { status: 404, contentType: 'audio/ogg' });

        expect(await service.warm(SOURCE_ID)).toBe(false);
        expect(recordFailure).toHaveBeenCalled();
    });
});

// Giving up on a copy the provider will not serve. The station narrows its own rotation here, so the
// threshold has to be reached by CONSECUTIVE failures and by nothing else.
describe('benching a binding that will not serve', () => {
    const failing = (attempts: number): SourceAudio => ({ ...BINDING, attempts });

    it('leaves a binding alone while it is still worth retrying', async () => {
        const { service, markBindingMissing } = build({ source: failing(2) });
        respondWith(RECORD, { status: 502, contentType: 'audio/ogg' });

        await service.ensure(SOURCE_ID);

        expect(markBindingMissing).not.toHaveBeenCalled();
    });

    it('writes the copy off once the failures run out of patience', async () => {
        // Three already recorded, so this failure is the fourth.
        const { service, markBindingMissing } = build({ source: failing(3) });
        respondWith(RECORD, { status: 502, contentType: 'audio/ogg' });

        await service.ensure(SOURCE_ID);

        expect(markBindingMissing).toHaveBeenCalledExactlyOnceWith('deadair.spotify', 'track-42');
    });

    // The mark is idempotent in the repository, so a later failure on an already-benched binding says
    // nothing rather than repeating a line an operator has seen.
    it('says nothing when the copy was already written off', async () => {
        const { service, markBindingMissing } = build({ source: failing(9) });
        markBindingMissing.mockResolvedValue(false);
        respondWith(RECORD, { status: 502, contentType: 'audio/ogg' });

        await service.ensure(SOURCE_ID);

        expect(markBindingMissing).toHaveBeenCalled();
    });

    // The failure mode with teeth: with the cache off there is no checksum to distinguish a healthy
    // binding from a failing one, so a fetch that WORKS has to clear the count or a working catalogue
    // benches itself one record at a time.
    it('resets nothing itself, but records a success that does', async () => {
        const { service, recordSuccess, markBindingMissing } = build({ source: failing(3), keeping: false });
        respondWith(RECORD, { contentType: 'audio/ogg' });

        expect(await service.ensure(SOURCE_ID)).toBeDefined();
        expect(recordSuccess).toHaveBeenCalledWith(SOURCE_ID, undefined);
        expect(markBindingMissing).not.toHaveBeenCalled();
    });

    // Not being able to write the mark must not fail a request that has already answered.
    it('swallows a failure to write the mark', async () => {
        const { service, markBindingMissing } = build({ source: failing(3) });
        markBindingMissing.mockRejectedValue(new Error('the pool is gone'));
        respondWith(RECORD, { status: 502, contentType: 'audio/ogg' });

        await expect(service.ensure(SOURCE_ID)).resolves.toBeUndefined();
    });
});
