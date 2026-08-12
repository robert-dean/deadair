// The fetch half, with `fetch` stubbed: what counts as a record, what is refused, and the fact that
// every failure lands as a row rather than as a thrown error — because the row is what stops the next
// boundary from asking a provider that just said no, and because nothing upstream of here is waiting.
//
// The claim is the other load-bearing half and is exercised against a real database rather than here:
// what matters about it is the SQL, and a fake that answers `true` would prove nothing.

import { readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_TRACK_BYTES, TrackCacheService } from '../../../../src/modules/playout/audio/track.cache.service.js';
import type { TrackAudioRepository } from '../../../../src/modules/playout/audio/track.audio.repository.js';
import { TrackStore } from '../../../../src/modules/playout/audio/track.store.js';
import { TRACK_CACHE_KEY } from '../../../../src/modules/playout/audio/track.cache.settings.js';
import type { PluginTrackResolver } from '../../../../src/modules/playout/providers/plugin.resolver.js';

const PLUGIN = 'deadair.navidrome';
const EXTERNAL = 'track-42';
const AUDIO_URL = 'http://navidrome:4533/rest/stream?id=track-42';

/** Comfortably over the floor, so the size guard is not what any of these tests is about. */
const RECORD = Buffer.alloc(32 * 1024, 7);

const BINDING = { sourceId: 'source-1' };

let root: string;
let store: TrackStore;

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() } as unknown as Logger;

const config = (values: Record<string, unknown> = {}): AppConfig =>
    ({ get: (key: string, fallback: unknown) => (key in values ? values[key] : fallback) }) as unknown as AppConfig;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deadair-track-cache-test-'));
    store = new TrackStore(root);
});

afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(root, { recursive: true, force: true });
});

/**
 * A repository that records what it was told rather than touching a database.
 *
 * No defaults on either parameter, deliberately: two of the cases this file exists for are "no
 * binding" and "no url", and a default would silently turn an explicit `undefined` back into the
 * happy path.
 */
const fakeRepository = (binding: { sourceId?: string; checksum?: string; ext?: string; byteSize?: number } | undefined, claimable: boolean) => {
    const successes: { sourceId: string; checksum: string; ext: string; contentType: string; byteSize: number }[] = [];
    const failures: { sourceId: string; error: string }[] = [];

    const repository = {
        findByBinding: vi.fn(async () => (binding === undefined ? undefined : { attempts: 0, dueForFetch: true, id: 'row-1', ...binding })),
        claim: vi.fn(async () => claimable),
        recordSuccess: vi.fn(async (sourceId: string, bytes: { checksum: string; ext: string; contentType: string; byteSize: number }) => {
            successes.push({ sourceId, ...bytes });
            return { id: 'row-1', sourceId, ...bytes, attempts: 1 };
        }),
        recordFailure: vi.fn(async (sourceId: string, error: string) => {
            failures.push({ sourceId, error });
        }),
    };

    return { repository: repository as unknown as TrackAudioRepository, calls: repository, successes, failures };
};

const fakeResolver = (url: string | undefined) => ({ resolveBinding: vi.fn(async () => url) }) as unknown as PluginTrackResolver;

const respondWith = (body: Buffer | undefined, init: { status?: number; contentType?: string } = {}): void => {
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
            const headers = new Headers(init.contentType === undefined ? {} : { 'content-type': init.contentType });
            return new Response(body === undefined ? null : new Uint8Array(body), { status: init.status ?? 200, headers });
        }),
    );
};

/** Every file the store holds, temp files included, so a failed write leaving a prefix behind shows up. */
const filesOnDisk = async (): Promise<string[]> => {
    const entries = await readdir(root, { recursive: true, withFileTypes: true });

    return entries.filter(entry => entry.isFile()).map(entry => entry.name);
};

describe('TrackCacheService.cache', () => {
    it('keeps the bytes and records them against the binding', async () => {
        const { repository, successes } = fakeRepository(BINDING, true);
        respondWith(RECORD, { contentType: 'audio/mpeg' });

        const service = new TrackCacheService(repository, store, fakeResolver(AUDIO_URL), config(), logger);
        const outcome = await service.cache(PLUGIN, EXTERNAL);

        expect(outcome).toEqual({ cached: true, checksum: expect.any(String), ext: 'mp3', byteSize: RECORD.byteLength });
        expect(successes).toEqual([
            { sourceId: 'source-1', checksum: expect.any(String), ext: 'mp3', contentType: 'audio/mpeg', byteSize: RECORD.byteLength },
        ]);
        expect(await store.read(successes[0]!.checksum, 'mp3')).toEqual(RECORD);
    });

    it('reads the extension off the content type, parameters and all', async () => {
        const { repository, successes } = fakeRepository(BINDING, true);
        respondWith(RECORD, { contentType: 'AUDIO/X-FLAC; charset=binary' });

        await new TrackCacheService(repository, store, fakeResolver(AUDIO_URL), config(), logger).cache(PLUGIN, EXTERNAL);

        expect(successes[0]!.ext).toBe('flac');
        expect(successes[0]!.contentType).toBe('audio/x-flac');
    });

    it('does nothing at all while the cache is turned off, not even claim the row', async () => {
        const { repository, calls } = fakeRepository(BINDING, true);
        respondWith(RECORD, { contentType: 'audio/mpeg' });

        const service = new TrackCacheService(repository, store, fakeResolver(AUDIO_URL), config({ [TRACK_CACHE_KEY]: 'false' }), logger);

        expect(await service.cache(PLUGIN, EXTERNAL)).toEqual({ cached: false, reason: expect.stringContaining('turned off') });
        expect(calls.claim).not.toHaveBeenCalled();
        expect(calls.recordFailure).not.toHaveBeenCalled();
        expect(await filesOnDisk()).toEqual([]);
    });

    it('answers with what it already holds rather than fetching it again', async () => {
        const { repository, calls } = fakeRepository({ sourceId: 'source-1', checksum: 'b'.repeat(64), ext: 'ogg', byteSize: 900 }, true);
        respondWith(RECORD, { contentType: 'audio/ogg' });

        const outcome = await new TrackCacheService(repository, store, fakeResolver(AUDIO_URL), config(), logger).cache(PLUGIN, EXTERNAL);

        expect(outcome).toEqual({ cached: true, checksum: 'b'.repeat(64), ext: 'ogg', byteSize: 900 });
        expect(calls.claim).not.toHaveBeenCalled();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    // The whole point of the claim: the resolver fires this off a boundary without waiting, so a
    // record coming round twice while the first download is in flight must not be downloaded twice.
    it('stands down when another fetch holds the binding', async () => {
        const { repository } = fakeRepository({ sourceId: 'source-1' }, false);
        respondWith(RECORD, { contentType: 'audio/mpeg' });

        const outcome = await new TrackCacheService(repository, store, fakeResolver(AUDIO_URL), config(), logger).cache(PLUGIN, EXTERNAL);

        expect(outcome).toEqual({ cached: false, reason: expect.stringContaining('another fetch') });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('has nothing to cache against when the catalog does not know the binding', async () => {
        const { repository, failures } = fakeRepository(undefined, true);
        respondWith(RECORD, { contentType: 'audio/mpeg' });

        const outcome = await new TrackCacheService(repository, store, fakeResolver(AUDIO_URL), config(), logger).cache(PLUGIN, EXTERNAL);

        expect(outcome).toEqual({ cached: false, reason: expect.stringContaining('does not know') });
        expect(failures).toEqual([]);
    });

    it.each([
        ['a provider that will not mint a url', () => fakeResolver(undefined), () => respondWith(RECORD, { contentType: 'audio/mpeg' })],
        ['an upstream that answered 502', () => fakeResolver(AUDIO_URL), () => respondWith(RECORD, { status: 502, contentType: 'audio/mpeg' })],
        [
            'an error page served as a 200',
            () => fakeResolver(AUDIO_URL),
            () => respondWith(Buffer.from('<html>nope</html>'), { contentType: 'text/html' }),
        ],
        ['a response with no content type at all', () => fakeResolver(AUDIO_URL), () => respondWith(RECORD)],
        [
            'a body too short to be a record',
            () => fakeResolver(AUDIO_URL),
            () => respondWith(Buffer.from('unauthorized'), { contentType: 'audio/mpeg' }),
        ],
    ])('records %s as a failure on the row rather than throwing', async (_, resolver, respond) => {
        const { repository, failures, successes } = fakeRepository(BINDING, true);
        respond();

        const outcome = await new TrackCacheService(repository, store, resolver(), config(), logger).cache(PLUGIN, EXTERNAL);

        expect(outcome.cached).toBe(false);
        expect(failures).toHaveLength(1);
        expect(failures[0]!.sourceId).toBe('source-1');
        expect(successes).toEqual([]);
    });

    it('refuses a url a plugin minted for something that is not http', async () => {
        const { repository, failures } = fakeRepository(BINDING, true);
        respondWith(RECORD, { contentType: 'audio/mpeg' });

        const service = new TrackCacheService(repository, store, fakeResolver('file:///etc/passwd'), config(), logger);

        expect((await service.cache(PLUGIN, EXTERNAL)).cached).toBe(false);
        expect(failures[0]!.error).toMatch(/refusing to fetch file:/);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    // A truncated record would air as a song that stops mid-verse, which is worse than the provider
    // fetch this replaces. So the cap has to leave NOTHING behind: no file under a name claiming to
    // be the whole record, and no temp file either.
    it('stores nothing when the body runs over the cap', async () => {
        const { repository, failures, successes } = fakeRepository(BINDING, true);
        const oversized = Buffer.alloc(MAX_TRACK_BYTES + 1024, 3);
        respondWith(oversized, { contentType: 'audio/flac' });

        const outcome = await new TrackCacheService(repository, store, fakeResolver(AUDIO_URL), config(), logger).cache(PLUGIN, EXTERNAL);

        expect(outcome).toEqual({ cached: false, reason: expect.stringContaining('larger than') });
        expect(successes).toEqual([]);
        expect(failures).toHaveLength(1);
        expect(await filesOnDisk()).toEqual([]);
    });
});
