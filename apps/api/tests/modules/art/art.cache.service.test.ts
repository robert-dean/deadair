// The download half, with `fetch` stubbed: what counts as art, what is too big, and the fact that
// every failure lands as a row rather than as a thrown error, because the sweep's next pass reads
// those rows to decide what to skip.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@maroonedsoftware/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ArtCacheService } from '../../../src/modules/art/art.cache.service.js';
import { ArtRepository } from '../../../src/modules/art/art.repository.js';
import { ArtStore } from '../../../src/modules/art/art.store.js';

const URL_JPG = 'https://coverartarchive.org/release/abc/front-500';
const BYTES = Buffer.from('cover art');

let root: string;
let store: ArtStore;

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() } as unknown as Logger;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deadair-art-cache-test-'));
    store = new ArtStore(root);
});

afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(root, { recursive: true, force: true });
});

/** A repository that records what it was told rather than touching a database. */
const fakeRepository = () => {
    const successes: { sourceUrl: string; checksum: string; ext: string; byteSize: number }[] = [];
    const failures: { sourceUrl: string; error: string }[] = [];

    const repository = {
        recordSuccess: vi.fn(async (sourceUrl: string, bytes: { checksum: string; ext: string; byteSize: number }) => {
            successes.push({ sourceUrl, ...bytes });
            return { id: 'asset-id', sourceUrl, checksum: bytes.checksum };
        }),
        recordFailure: vi.fn(async (sourceUrl: string, error: string) => {
            failures.push({ sourceUrl, error });
        }),
    };

    return { repository: repository as unknown as ArtRepository, successes, failures };
};

const respondWith = (body: Buffer | undefined, init: { status?: number; contentType?: string } = {}): void => {
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
            const headers = new Headers(init.contentType === undefined ? {} : { 'content-type': init.contentType });
            return new Response(body === undefined ? null : new Uint8Array(body), { status: init.status ?? 200, headers });
        }),
    );
};

describe('ArtCacheService.cache', () => {
    it('stores the bytes and records the asset', async () => {
        const { repository, successes } = fakeRepository();
        respondWith(BYTES, { contentType: 'image/jpeg' });

        const outcome = await new ArtCacheService(repository, store, logger).cache(URL_JPG);

        expect(outcome).toEqual({ cached: true, id: 'asset-id' });
        expect(successes).toHaveLength(1);
        expect(successes[0]!.ext).toBe('jpg');
        expect(successes[0]!.byteSize).toBe(BYTES.byteLength);
        expect(await store.read(successes[0]!.checksum, 'jpg')).toEqual(BYTES);
    });

    it('reads the extension off the content type, parameters and all', async () => {
        const { repository, successes } = fakeRepository();
        respondWith(BYTES, { contentType: 'IMAGE/PNG; charset=binary' });

        await new ArtCacheService(repository, store, logger).cache(URL_JPG);

        expect(successes[0]!.ext).toBe('png');
    });

    it('records a failure rather than throwing when the upstream is unhappy', async () => {
        const { repository, failures } = fakeRepository();
        respondWith(Buffer.from('nope'), { status: 404, contentType: 'text/html' });

        const outcome = await new ArtCacheService(repository, store, logger).cache(URL_JPG);

        expect(outcome.cached).toBe(false);
        expect(failures[0]!.error).toContain('404');
    });

    it('refuses a response that is not an image', async () => {
        const { repository, failures } = fakeRepository();
        respondWith(Buffer.from('<html>rate limited</html>'), { contentType: 'text/html' });

        expect((await new ArtCacheService(repository, store, logger).cache(URL_JPG)).cached).toBe(false);
        expect(failures[0]!.error).toContain('not an image');
    });

    it('refuses an image larger than the cap', async () => {
        const { repository, failures } = fakeRepository();
        respondWith(Buffer.alloc(6 * 1024 * 1024, 1), { contentType: 'image/jpeg' });

        expect((await new ArtCacheService(repository, store, logger).cache(URL_JPG)).cached).toBe(false);
        expect(failures[0]!.error).toContain('larger than');
    });

    it('refuses an empty body', async () => {
        const { repository, failures } = fakeRepository();
        respondWith(Buffer.alloc(0), { contentType: 'image/jpeg' });

        expect((await new ArtCacheService(repository, store, logger).cache(URL_JPG)).cached).toBe(false);
        expect(failures[0]!.error).toContain('empty');
    });

    // These URLs come from plugin code. `file:` would turn a bad mapping into a local file read.
    it('refuses a scheme that is not http(s), without fetching', async () => {
        const { repository, failures } = fakeRepository();
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);

        expect((await new ArtCacheService(repository, store, logger).cache('file:///etc/passwd')).cached).toBe(false);
        expect(failures[0]!.error).toContain('file:');
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('records a failure when the fetch itself blows up', async () => {
        const { repository, failures } = fakeRepository();
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new Error('connect ECONNREFUSED');
            }),
        );

        expect((await new ArtCacheService(repository, store, logger).cache(URL_JPG)).cached).toBe(false);
        expect(failures[0]!.error).toContain('ECONNREFUSED');
    });

    // Two URLs for the same image are two rows, but the store is content-addressed, so they share
    // one file. That is the whole reason the disk layout is not keyed by the asset id.
    it('writes one file for two URLs carrying identical bytes', async () => {
        const { repository, successes } = fakeRepository();
        respondWith(BYTES, { contentType: 'image/jpeg' });
        const service = new ArtCacheService(repository, store, logger);

        await service.cache(URL_JPG);
        await service.cache('https://i.scdn.co/image/abc');

        expect(successes).toHaveLength(2);
        expect(successes[0]!.checksum).toBe(successes[1]!.checksum);
    });
});
