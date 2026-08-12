// The job around the fetch: that it passes the binding and the runner's signal through, and that a
// send carrying nothing is a logged bug rather than a throw. Everything about what a fetch does lives
// in the service and is tested there.

import { Container } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { describe, expect, it, vi } from 'vitest';

import { CacheTrackJob } from '../../../../src/modules/playout/audio/cache.track.job.js';
import type { TrackCacheService } from '../../../../src/modules/playout/audio/track.cache.service.js';

vi.mock('#modules/jobs/job.authorization.js', () => ({ overrideJobActor: vi.fn() }));

const context = { id: 'job-1' } as unknown as JobContext;
const container = {} as unknown as Container;

const harness = (outcome: { cached: boolean } = { cached: true }) => {
    const cache = vi.fn(async () => outcome as never);
    const warn = vi.fn();
    const logger = { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn(), trace: vi.fn() } as unknown as Logger;

    return { job: new CacheTrackJob({ cache } as unknown as TrackCacheService, context, container, logger), cache, warn };
};

describe('CacheTrackJob', () => {
    it('hands the binding and the cancellation it was given to the cache', async () => {
        const controller = new AbortController();
        const { job, cache } = harness();

        await job.run({ pluginId: 'deadair.navidrome', externalId: 'track-42' }, controller.signal);

        expect(cache).toHaveBeenCalledWith('deadair.navidrome', 'track-42', controller.signal);
    });

    it.each([
        ['nothing at all', undefined],
        ['no plugin', { externalId: 'track-42' }],
        ['no track', { pluginId: 'deadair.navidrome' }],
    ])('says a send carrying %s was a caller bug and fetches nothing', async (_, payload) => {
        const { job, cache, warn } = harness();

        await job.run(payload);

        expect(cache).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('no binding'), { job: 'job-1' });
    });

    // A failed fetch is data the service put on the row. Rethrowing would spend the broker's one
    // retry on a provider that is usually still refusing, and the next play of the record is the
    // better retry anyway.
    it('does not fail the job when the record could not be kept', async () => {
        const { job } = harness({ cached: false });

        await expect(job.run({ pluginId: 'deadair.navidrome', externalId: 'track-42' })).resolves.toBeUndefined();
    });
});
