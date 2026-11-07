// The job around one measurement: that it hands the binding to the service, that a send carrying
// nothing is a logged bug rather than a throw, and that it speaks only when the analyzer was asked.
// What a measurement does, and when a track is due one, is the service's and the repository's.

import { Container } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { describe, expect, it, vi } from 'vitest';

import { AnalyseTrackJob } from '../../../src/modules/analysis/analyse.track.job.js';
import type { AnalysisService } from '../../../src/modules/analysis/analysis.service.js';
import { JobMappings } from '../../../src/modules/jobs/job.mappings.js';

vi.mock('#modules/jobs/job.authorization.js', () => ({ overrideJobActor: vi.fn() }));

const context = { id: 'job-1' } as unknown as JobContext;
const container = {} as unknown as Container;

const harness = (outcome: Awaited<ReturnType<AnalysisService['analyseSource']>> = 'measured') => {
    const analyseSource = vi.fn(async () => outcome);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() } as unknown as Logger;

    return { job: new AnalyseTrackJob({ analyseSource } as unknown as AnalysisService, context, container, logger), analyseSource, logger };
};

describe('AnalyseTrackJob', () => {
    it('measures the track behind the binding it was sent', async () => {
        const { job, analyseSource } = harness();

        await job.run({ sourceId: 'source-1' });

        expect(analyseSource).toHaveBeenCalledWith('source-1');
    });

    it.each([
        ['nothing at all', undefined],
        ['an empty object', {}],
    ])('says a send carrying %s was a caller bug and measures nothing', async (_, payload) => {
        const { job, analyseSource, logger } = harness();

        await job.run(payload);

        expect(analyseSource).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no binding'), { job: 'job-1' });
    });

    it.each(['measured', 'failed'] as const)('says so when the analyzer was asked and the answer was %s', async outcome => {
        const { job, logger } = harness(outcome);

        await job.run({ sourceId: 'source-1' });

        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('as it arrived'), expect.objectContaining({ source: 'source-1', outcome }));
    });

    // A duplicate, a record already measured, and a station with no analyzer are all ordinary, and a
    // few of them an hour would be a log of nothing.
    it.each(['current', 'none', 'withheld'] as const)('stays quiet when the answer was %s', async outcome => {
        const { job, logger } = harness(outcome);

        await job.run({ sourceId: 'source-1' });

        expect(logger.info).not.toHaveBeenCalled();
    });

    // One job at a time is what makes the second of two sends for one record find it measured.
    it('runs one at a time, so a duplicate finds the first one done', () => {
        const mapping = JobMappings['catalog.analyze_track'];

        expect(typeof mapping === 'function' ? undefined : mapping.worker).toBeUndefined();
    });
});
