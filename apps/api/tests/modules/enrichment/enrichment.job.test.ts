// The run budget. What matters here is that the clock, not the row count, is
// what stops the walk: a count only predicts a duration if you know what a
// request costs, and when MusicBrainz is shedding load it costs ten seconds
// rather than one. A run that overran its cron interval would collide with the
// next one on the same rate limiter, and both would starve into timeouts.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { EnrichmentJob, RUN_BUDGET_MS } from '../../../src/modules/enrichment/enrichment.job.js';
import type { EnrichmentPassSummary } from '../../../src/modules/enrichment/enrichment.service.js';

const idle: EnrichmentPassSummary = { scanned: 0, enriched: 0, promoted: 0, failed: 0 };
const busy: EnrichmentPassSummary = { scanned: 3, enriched: 3, promoted: 1, failed: 0 };

const stubLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

/** Only `override` is reached: `overrideJobActor` installs the actor and nothing else. */
const stubContainer = () => ({ override: vi.fn() });

interface Harness {
    job: EnrichmentJob;
    logger: Logger;
    signals: (AbortSignal | undefined)[];
}

/**
 * `onPass` runs inside each pass, which is where a test that wants to observe
 * the budget expiring advances the clock: the passes are the only thing between
 * the timer being set and it being cleared.
 */
const build = (onPass: () => void = () => {}, summary: EnrichmentPassSummary = busy): Harness => {
    const signals: (AbortSignal | undefined)[] = [];
    const pass = vi.fn(async (_limit: number, signal?: AbortSignal) => {
        signals.push(signal);
        onPass();
        return summary;
    });

    const enrichment = {
        enrichPending: pass,
        enrichPendingArtists: pass,
        enrichPendingAlbums: pass,
    };

    const logger = stubLogger();
    const job = new EnrichmentJob(enrichment as never, { id: 'job-1' } as never, stubContainer() as never, logger);

    return { job, logger, signals };
};

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('EnrichmentJob run budget', () => {
    it('hands every pass a signal, so a slow upstream can be told to stop', async () => {
        const { job, signals } = build();

        await job.run();

        expect(signals).toHaveLength(3);
        expect(signals.every(signal => signal !== undefined)).toBe(true);
    });

    it('does not abort a run that finishes inside its budget', async () => {
        const { job, signals, logger } = build(() => vi.advanceTimersByTime(1000));

        await job.run();

        expect(signals.every(signal => !signal!.aborted)).toBe(true);
        expect(logger.info).toHaveBeenCalledWith('enrichment pass', expect.objectContaining({ outOfTime: false }));
    });

    it('stops asking for work once the budget is spent, and says so', async () => {
        const { job, signals, logger } = build(() => vi.advanceTimersByTime(RUN_BUDGET_MS));

        await job.run();

        // The first pass ran the clock out, so the later ones see an aborted
        // signal and stop at their next clean boundary rather than starting
        // another entity.
        expect(signals.at(-1)!.aborted).toBe(true);
        expect(logger.info).toHaveBeenCalledWith('enrichment pass', expect.objectContaining({ outOfTime: true }));
    });

    it('still honours a caller that aborts before the budget runs out', async () => {
        const controller = new AbortController();
        const { job, signals } = build(() => controller.abort());

        await job.run(undefined, controller.signal);

        expect(signals.at(-1)!.aborted).toBe(true);
    });

    it('clears its timer, so a finished run leaves nothing pending', async () => {
        const { job } = build();

        await job.run();

        expect(vi.getTimerCount()).toBe(0);
    });

    it('says nothing at all when there was nothing to do', async () => {
        const { job, logger } = build(() => {}, idle);

        await job.run();

        expect(logger.info).not.toHaveBeenCalled();
    });
});
