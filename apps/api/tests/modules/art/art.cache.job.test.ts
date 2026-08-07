// The sweep around the download: that it works its batch through a shared cursor rather than
// fixed slices, that it stops when the runner cancels it, and that an empty queue is silent.

import { Container } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { describe, expect, it, vi } from 'vitest';

import { ArtCacheJob } from '../../../src/modules/art/art.cache.job.js';
import { ArtCacheService } from '../../../src/modules/art/art.cache.service.js';
import { ArtRepository } from '../../../src/modules/art/art.repository.js';

vi.mock('#modules/jobs/job.authorization.js', () => ({ overrideJobActor: vi.fn() }));

const context = { id: 'job-1' } as unknown as JobContext;
const container = {} as unknown as Container;

const job = (pending: string[], cache: (url: string) => Promise<{ cached: boolean }>) => {
    const info = vi.fn();
    const listPendingSourceUrls = vi.fn(async (limit: number) => pending.slice(0, limit));
    const artCache = { cache: vi.fn(async (url: string) => (await cache(url)) as never) } as unknown as ArtCacheService;

    return {
        job: new ArtCacheJob(artCache, { listPendingSourceUrls } as unknown as ArtRepository, context, container, {
            info,
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            trace: vi.fn(),
        } as unknown as Logger),
        info,
        listPendingSourceUrls,
        artCache,
    };
};

describe('ArtCacheJob', () => {
    it('caches every pending URL and reports the tally', async () => {
        const urls = ['https://cdn/1.jpg', 'https://cdn/2.jpg', 'https://cdn/3.jpg'];
        const seen: string[] = [];
        const harness = job(urls, async url => {
            seen.push(url);
            return { cached: url !== 'https://cdn/2.jpg' };
        });

        await harness.job.run();

        expect(seen.sort()).toEqual(urls);
        expect(harness.info).toHaveBeenCalledWith('art cache pass', { job: 'job-1', scanned: 3, cached: 2, failed: 1 });
    });

    it('says nothing when there is nothing to fetch', async () => {
        const harness = job([], async () => ({ cached: true }));

        await harness.job.run();

        expect(harness.info).not.toHaveBeenCalled();
    });

    it('takes its batch size from the payload when one is given', async () => {
        const harness = job(['https://cdn/1.jpg', 'https://cdn/2.jpg'], async () => ({ cached: true }));

        await harness.job.run({ limit: 1 });

        expect(harness.listPendingSourceUrls).toHaveBeenCalledWith(1);
        expect(harness.artCache.cache).toHaveBeenCalledTimes(1);
    });

    // The runner aborts on shutdown. The URLs left behind are still uncached, so the next pass
    // picks them up: stopping early costs nothing and holding the process open costs a restart.
    it('stops working the batch once the runner cancels it', async () => {
        const controller = new AbortController();
        const urls = Array.from({ length: 20 }, (_, index) => `https://cdn/${index}.jpg`);
        const harness = job(urls, async () => {
            controller.abort();
            return { cached: true };
        });

        await harness.job.run(undefined, controller.signal);

        // The four workers in flight when the abort landed may each finish their current URL, but
        // nothing beyond that is started.
        expect((harness.artCache.cache as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(4);
    });
});
