// `GET /art/source/{token}` is anonymous and fetches upstream on demand, so what it must get right
// is mostly what it must NOT do: fetch for a token it did not mint, fetch twice for one cover asked
// for at once, fetch again inside a recorded failure's backoff, or answer anything but a 404 when
// there is no cover to give.

import { HttpError } from '@maroonedsoftware/errors';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArtAsset } from '../../../src/modules/art/art.repository.js';
import { ArtSourceService } from '../../../src/modules/art/art.source.service.js';
import { clearArtSourceKey, configureArtSourceKey, sealSourceUrl } from '../../../src/modules/art/art.source.token.js';

const UPSTREAM = 'https://music.example/rest/getCoverArt.view?id=al-42&u=operator&t=secret&s=salt';
const CACHED: ArtAsset = { id: 'asset-1', sourceUrl: UPSTREAM, checksum: 'c'.repeat(64), ext: 'jpg' };

beforeEach(() => configureArtSourceKey('cd'.repeat(32)));
afterEach(() => clearArtSourceKey());

const build = (state?: { asset: ArtAsset; backingOff: boolean }) => {
    const repository = {
        findSourceState: vi.fn(async () => state),
        findById: vi.fn(async () => CACHED),
    };
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => (release = resolve));
    const cache = {
        cache: vi.fn(async () => {
            await gate;
            return { cached: true as const, id: 'asset-1' };
        }),
    };
    const store = { read: vi.fn(async () => Buffer.from('jpeg-bytes')) };
    const service = new ArtSourceService(repository as never, cache as never, store as never);
    return { service, repository, cache, store, release };
};

const statusOf = async (promise: Promise<unknown>): Promise<number | 'ok'> => {
    try {
        await promise;
        return 'ok';
    } catch (error) {
        return (error as HttpError).statusCode;
    }
};

describe('ArtSourceService', () => {
    it('serves the bytes the station already holds for the URL, without fetching', async () => {
        const { service, cache } = build({ asset: CACHED, backingOff: false });

        const answer = await service.getSourceArt(sealSourceUrl(UPSTREAM)!);

        expect(answer.contentType).toBe('image/jpeg');
        expect(answer.body.toString()).toBe('jpeg-bytes');
        expect(answer.headers.etag).toBe(`"${CACHED.checksum}"`);
        expect(cache.cache).not.toHaveBeenCalled();
    });

    it('fetches an uncached cover into the store, then serves it', async () => {
        const { service, cache, release } = build(undefined);
        release();

        const answer = await service.getSourceArt(sealSourceUrl(UPSTREAM)!);

        expect(cache.cache).toHaveBeenCalledWith(UPSTREAM);
        expect(answer.body.toString()).toBe('jpeg-bytes');
    });

    it('fetches once for a cover asked for many times at once', async () => {
        const { service, cache, release } = build(undefined);
        const token = sealSourceUrl(UPSTREAM)!;

        const asks = Array.from({ length: 5 }, () => service.getSourceArt(token));
        await vi.waitFor(() => expect(cache.cache).toHaveBeenCalled());
        release();
        const answers = await Promise.all(asks);

        expect(cache.cache).toHaveBeenCalledTimes(1);
        expect(answers.every(answer => answer.body.toString() === 'jpeg-bytes')).toBe(true);
    });

    it('does not fetch again inside a recorded failure backoff, and answers 404', async () => {
        const { service, cache } = build({ asset: { id: 'asset-1', sourceUrl: UPSTREAM }, backingOff: true });

        expect(await statusOf(service.getSourceArt(sealSourceUrl(UPSTREAM)!))).toBe(404);
        expect(cache.cache).not.toHaveBeenCalled();
    });

    it('tries again once the backoff has passed', async () => {
        const { service, cache, release } = build({ asset: { id: 'asset-1', sourceUrl: UPSTREAM }, backingOff: false });
        release();

        await service.getSourceArt(sealSourceUrl(UPSTREAM)!);

        expect(cache.cache).toHaveBeenCalledOnce();
    });

    it('answers 404 when the fetch fails, never a 5xx', async () => {
        const { service, cache } = build(undefined);
        cache.cache.mockResolvedValueOnce({ cached: false, reason: 'HTTP 500' } as never);

        expect(await statusOf(service.getSourceArt(sealSourceUrl(UPSTREAM)!))).toBe(404);
    });

    it('answers 404 for a token it did not mint, and asks nothing of anybody', async () => {
        const { service, repository, cache } = build(undefined);
        const token = sealSourceUrl(UPSTREAM)!;
        const forged = `${token.slice(0, -2)}${token.endsWith('AA') ? 'BB' : 'AA'}`;

        expect(await statusOf(service.getSourceArt(forged))).toBe(404);
        expect(repository.findSourceState).not.toHaveBeenCalled();
        expect(cache.cache).not.toHaveBeenCalled();
    });

    it('serves the same bytes under a filename, which it never reads', async () => {
        const { service } = build({ asset: CACHED, backingOff: false });

        const answer = await service.getSourceArtFile(sealSourceUrl(UPSTREAM)!, 'cover.png');

        expect(answer.contentType).toBe('image/jpeg');
    });
});
