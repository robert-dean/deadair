// The job around the fetch: that it passes the binding and the runner's signal through, and that a
// send carrying nothing is a logged bug rather than a throw. Everything about what a fetch does lives
// in the service and is tested there.

import { Container } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { describe, expect, it, vi } from 'vitest';

import { CacheTrackJob } from '../../../../src/modules/playout/audio/cache.track.job.js';
import type { TrackAudioService } from '../../../../src/modules/playout/audio/track.audio.service.js';

vi.mock('#modules/jobs/job.authorization.js', () => ({ overrideJobActor: vi.fn() }));

const context = { id: 'job-1' } as unknown as JobContext;
const container = {} as unknown as Container;

const harness = (got = true) => {
    const warm = vi.fn(async () => got);
    const warn = vi.fn();
    const logger = { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn(), trace: vi.fn() } as unknown as Logger;

    return { job: new CacheTrackJob({ warm } as unknown as TrackAudioService, context, container, logger), warm, warn };
};

describe('CacheTrackJob', () => {
    it('hands the binding and the cancellation it was given to the audio service', async () => {
        const controller = new AbortController();
        const { job, warm } = harness();

        await job.run({ sourceId: 'source-1' }, controller.signal);

        expect(warm).toHaveBeenCalledWith('source-1', controller.signal);
    });

    it.each([
        ['nothing at all', undefined],
        ['an empty object', {}],
    ])('says a send carrying %s was a caller bug and fetches nothing', async (_, payload) => {
        const { job, warm, warn } = harness();

        await job.run(payload);

        expect(warm).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('no binding'), { job: 'job-1' });
    });

    // A failed fetch is data the service put on the row. Rethrowing would spend the broker's one
    // retry on a provider that is usually still refusing, and the request that actually needs the
    // record is the better retry anyway.
    it('does not fail the job when the record could not be had', async () => {
        const { job } = harness(false);

        await expect(job.run({ sourceId: 'source-1' })).resolves.toBeUndefined();
    });
});
