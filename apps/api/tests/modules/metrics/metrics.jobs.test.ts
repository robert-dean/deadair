// The two jobs over `metric_samples`. The rollup has to be safe to run any number of times over any
// hours, so what is pinned is WHICH hours it folds; the prune deletes, so what is pinned is the
// direction every doubtful reading falls, as in the activity sweep beside it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import { DateTime } from 'luxon';

import { PruneMetricsJob } from '../../../src/modules/metrics/prune.metrics.job.js';
import { ROLLUP_HOURS, RollupMetricsJob } from '../../../src/modules/metrics/rollup.metrics.job.js';
import {
    METRICS_DEFAULTS,
    METRICS_KEYS,
    resolveHourRetentionDays,
    resolveMinuteRetentionDays,
} from '../../../src/modules/metrics/metrics.settings.js';

vi.mock('../../../src/modules/jobs/job.authorization.js', () => ({ overrideJobActor: vi.fn() }));

const config = (values: Record<string, unknown>): AppConfig =>
    ({ get: (key: string, fallback: unknown) => (key in values ? values[key] : fallback) }) as unknown as AppConfig;
const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

describe('metrics retention settings', () => {
    it('keep the registry defaults when nobody has set them', () => {
        expect(resolveMinuteRetentionDays(config({}))).toBe(METRICS_DEFAULTS.minuteRetentionDays);
        expect(resolveHourRetentionDays(config({}))).toBe(METRICS_DEFAULTS.hourRetentionDays);
    });

    it('read a number that arrived as a string, which is how a settings row stores one', () => {
        expect(resolveMinuteRetentionDays(config({ [METRICS_KEYS.minuteRetentionDays]: '3' }))).toBe(3);
    });

    it.each([
        ['zero', '0'],
        ['a word', 'forever'],
        ['a negative', '-1'],
    ])('keep everything for %s', (_, value) => {
        expect(resolveHourRetentionDays(config({ [METRICS_KEYS.hourRetentionDays]: value }))).toBe(0);
    });
});

describe('RollupMetricsJob', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-16T12:09:30Z'));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('folds the last few complete hours, oldest first, and never the one still running', async () => {
        const metrics = { rollupHour: vi.fn(async (_hour: DateTime) => 2) };
        const job = new RollupMetricsJob(metrics as never, { id: 'job-1' } as never, {} as never, logger() as never);

        await job.run();

        const hours = metrics.rollupHour.mock.calls.map(([hour]) => hour.toISO());
        expect(hours).toEqual(['2026-10-16T09:00:00.000Z', '2026-10-16T10:00:00.000Z', '2026-10-16T11:00:00.000Z']);
        expect(hours).toHaveLength(ROLLUP_HOURS);
    });
});

describe('PruneMetricsJob', () => {
    function harness(values: Record<string, unknown> = {}, removed = 0) {
        const metrics = { pruneOlderThanDays: vi.fn(async () => removed) };
        const log = logger();
        const job = new PruneMetricsJob(metrics as never, config(values), { id: 'job-1' } as never, {} as never, log as never);
        return { job, metrics, log };
    }

    it('sweeps each resolution to its own window', async () => {
        const { job, metrics } = harness({ [METRICS_KEYS.minuteRetentionDays]: '7', [METRICS_KEYS.hourRetentionDays]: '400' });

        await job.run();

        expect(metrics.pruneOlderThanDays).toHaveBeenCalledWith('minute', 7);
        expect(metrics.pruneOlderThanDays).toHaveBeenCalledWith('hour', 400);
    });

    it('passes a zero window through as zero, which the repository answers by deleting nothing', async () => {
        const { job, metrics } = harness({ [METRICS_KEYS.hourRetentionDays]: '0' });

        await job.run();

        expect(metrics.pruneOlderThanDays).toHaveBeenCalledWith('hour', 0);
    });

    it('says nothing when nothing was old enough', async () => {
        const { job, log } = harness({}, 0);

        await job.run();

        expect(log.info).not.toHaveBeenCalled();
    });
});
