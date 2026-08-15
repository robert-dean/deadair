// The run budget. What matters here is that the clock, not the row count, is
// what stops the walk: a count only predicts a duration if you know what a
// request costs, and when MusicBrainz is shedding load it costs ten seconds
// rather than one. A run that overran its cron interval would collide with the
// next one on the same rate limiter, and both would starve into timeouts.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { EnrichmentJob, RUN_BUDGET_MS } from '../../../src/modules/enrichment/enrichment.job.js';
import type { EnrichmentPassSummary } from '../../../src/modules/enrichment/enrichment.service.js';
import type { EnrichmentPriority } from '../../../src/modules/enrichment/lineup.priority.js';

const idle: EnrichmentPassSummary = { scanned: 0, enriched: 0, promoted: 0, failed: 0 };
const busy: EnrichmentPassSummary = { scanned: 3, enriched: 3, promoted: 1, failed: 0 };

const stubLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

/** Only `override` is reached: `overrideJobActor` installs the actor and nothing else. */
const stubContainer = () => ({ override: vi.fn() });

interface Harness {
    job: EnrichmentJob;
    logger: Logger;
    signals: (AbortSignal | undefined)[];
    /** Every job the run asked for. `catalog.extract_facts` is chained off a run that enriched anything. */
    sent: string[];
    /** What each pass was told the station is about to play, in call order: tracks, artists, albums. */
    priorities: (readonly string[] | undefined)[];
}

/**
 * `onPass` runs inside each pass, which is where a test that wants to observe
 * the budget expiring advances the clock: the passes are the only thing between
 * the timer being set and it being cleared.
 */
const build = (onPass: () => void = () => {}, summary: EnrichmentPassSummary = busy, read = OFF_AIR): Harness => {
    const signals: (AbortSignal | undefined)[] = [];
    const priorities: (readonly string[] | undefined)[] = [];
    const pass = vi.fn(async (_limit: number, signal?: AbortSignal, priority?: readonly string[]) => {
        signals.push(signal);
        priorities.push(priority);
        onPass();
        return summary;
    });

    const enrichment = {
        enrichPending: pass,
        enrichPendingArtists: pass,
        enrichPendingAlbums: pass,
    };

    const logger = stubLogger();
    const priority = { read };
    const sent: string[] = [];
    const jobs = { send: vi.fn(async (name: string) => void sent.push(name)) };

    const job = new EnrichmentJob(enrichment as never, priority as never, jobs as never, { id: 'job-1' } as never, stubContainer() as never, logger);

    return { job, logger, signals, sent, priorities };
};

/**
 * An off-air station, which is the ordinary shape for the budget tests: what the clock does has
 * nothing to do with what the running order holds, and a walk with no priority sorts as it always
 * did.
 */
const OFF_AIR = async (): Promise<EnrichmentPriority> => ({ trackIds: [], artistIds: [], albumIds: [] });

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

/**
 * What the station is about to play leading the walk.
 *
 * The ORDERING itself is SQL and is covered by `scripts/enrichment.priority.smoke.ts` against the
 * real database. What is testable here is the wiring either side of it: that each pass is told about
 * its own level, that a station whose order cannot be read still walks, and that the run reads it
 * once rather than three times.
 */
describe('EnrichmentJob priority', () => {
    const onAir = async (): Promise<EnrichmentPriority> => ({ trackIds: ['track-1'], artistIds: ['artist-1'], albumIds: ['album-1'] });

    it('gives each pass the level it asks about', async () => {
        const { job, priorities } = build(() => {}, busy, onAir);

        await job.run();

        // Tracks, then artists, then albums — the order `execute` runs them in.
        expect(priorities).toEqual([['track-1'], ['artist-1'], ['album-1']]);
    });

    it('reads the running order once, not once per pass', async () => {
        const read = vi.fn(onAir);
        const { job } = build(() => {}, busy, read);

        await job.run();

        // A walk can take minutes, so re-reading per pass would cost two more queries to chase an
        // order that has moved — and leave the passes disagreeing about which artist went with
        // which record.
        expect(read).toHaveBeenCalledTimes(1);
    });

    it('walks anyway when it cannot tell what the station is about to play', async () => {
        const { job, priorities, logger } = build(
            () => {},
            busy,
            async () => {
                throw new Error('no');
            },
        );

        await job.run();

        // The old behaviour, exactly: everything ahead of the cursor is still in the queue, it just
        // waits its turn. Degrading to no walk at all would be the worse failure by far.
        expect(priorities).toEqual([[], [], []]);
        expect(logger.warn).toHaveBeenCalledWith('enrichment: could not read what the station is about to play', expect.anything());
    });
});

describe('EnrichmentJob fact extraction', () => {
    it('asks for the new documents to be read', async () => {
        const { job, sent } = build();

        await job.run();

        expect(sent).toEqual(['catalog.extract_facts']);
    });

    it('does not, when nothing was enriched', async () => {
        // Scanned but not enriched: every provider was asked and had nothing, so the pass wrote miss
        // rows and no document. There is nothing for the extractor to read.
        const { job, sent } = build(() => {}, { scanned: 3, enriched: 0, promoted: 0, failed: 0 });

        await job.run();

        expect(sent).toEqual([]);
    });

    it('does not fail the run when the broker will not take it', async () => {
        // Built by hand rather than through the harness, because the whole point is a `send` that
        // rejects: the extractor's cron is the backstop and an unread document keeps no mark, so it
        // is still outstanding — none of which is worth failing a walk that has already done its work.
        const logger = stubLogger();
        const job = new EnrichmentJob(
            { enrichPending: async () => busy, enrichPendingArtists: async () => busy, enrichPendingAlbums: async () => busy } as never,
            { read: OFF_AIR } as never,
            { send: async () => Promise.reject(new Error('no broker')) } as never,
            { id: 'job-1' } as never,
            stubContainer() as never,
            logger,
        );

        await expect(job.run()).resolves.toBeUndefined();
        expect(logger.warn).toHaveBeenCalledWith('enrichment: could not ask for the new documents to be read', expect.anything());
    });
});
