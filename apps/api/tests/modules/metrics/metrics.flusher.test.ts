// The flusher is the only writer of minute rows, and the two ways it can go wrong are both quiet: a
// minute that is never written, which is a gap on a chart nobody notices for a week, and a database
// outage that turns into a buffer growing in memory. What is pinned here is that a minute is written
// once, that a failed one is DROPPED rather than kept, that the outage is logged at its edges rather
// than every minute, and that shutdown writes the last partial minute.

import { describe, expect, it, vi } from 'vitest';
import type { Container } from 'injectkit';
import { MetricsRecorder, type MetricBucket } from '@maroonedsoftware/telemetry';

import { MetricsFlusher, METRICS_FLUSH_HEARTBEAT } from '../../../src/modules/metrics/metrics.flusher.js';
import { MetricsRepository } from '../../../src/modules/metrics/metrics.repository.js';
import { Heartbeat } from '../../../src/modules/shared/heartbeat.js';

function harness() {
    const written: MetricBucket[][] = [];
    const repository = { upsertMinutes: vi.fn(async (buckets: MetricBucket[]) => (written.push(buckets), buckets.length)) };
    const scope = { get: (token: unknown) => (token === MetricsRepository ? repository : undefined), disposeAsync: vi.fn(async () => {}) };
    const container = { createScopedContainer: () => scope } as unknown as Container;
    const recorder = new MetricsRecorder();
    const heartbeat = new Heartbeat();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const flusher = new MetricsFlusher(container, recorder, heartbeat, logger as never);
    return { flusher, recorder, repository, written, heartbeat, logger, scope };
}

describe('MetricsFlusher', () => {
    it('samples the gauges and writes what the recorder holds, in a scope of its own', async () => {
        const { flusher, recorder, written, scope } = harness();
        recorder.gauge('station.listeners', () => 3);
        recorder.observe('work.job.ms', 40);

        await flusher.flush();

        expect(written).toHaveLength(1);
        expect(written[0]?.map(b => b.name).sort()).toEqual(['station.listeners', 'work.job.ms']);
        expect(scope.disposeAsync).toHaveBeenCalled();
        expect(recorder.pending).toBe(0);
    });

    it('writes nothing when nothing was recorded, but still beats', async () => {
        const { flusher, repository, heartbeat } = harness();

        await flusher.flush();

        expect(repository.upsertMinutes).not.toHaveBeenCalled();
        expect(heartbeat.stalledFor(METRICS_FLUSH_HEARTBEAT)).toBe(0);
    });

    it('drops a minute it could not write, rather than keeping it to write later', async () => {
        const { flusher, recorder, repository, written } = harness();
        repository.upsertMinutes.mockRejectedValueOnce(new Error('connection refused'));
        recorder.observe('a', 1);

        await flusher.flush();
        recorder.observe('b', 1);
        await flusher.flush();

        expect(written.map(batch => batch.map(b => b.name))).toEqual([['b']]);
    });

    it('logs an outage when it starts and when it ends, not every minute in between', async () => {
        const { flusher, recorder, repository, logger } = harness();
        repository.upsertMinutes.mockRejectedValue(new Error('connection refused'));

        for (let minute = 0; minute < 3; minute += 1) {
            recorder.observe('a', minute);
            await flusher.flush();
        }
        repository.upsertMinutes.mockResolvedValue(1);
        recorder.observe('a', 9);
        await flusher.flush();

        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.info).toHaveBeenCalledWith('metrics: writing again', expect.objectContaining({ gapMs: expect.any(Number) }));
    });

    it('beats even when the write fails, so the loop is seen to be alive whether or not the database is', async () => {
        const { flusher, recorder, repository, heartbeat } = harness();
        repository.upsertMinutes.mockRejectedValue(new Error('down'));
        recorder.observe('a', 1);

        await flusher.flush();

        expect(heartbeat.stalledFor(METRICS_FLUSH_HEARTBEAT)).toBe(0);
    });

    it('writes the last partial minute on stop, and stops being watched', async () => {
        const { flusher, recorder, written, heartbeat } = harness();
        flusher.start();
        recorder.observe('a', 1);

        await flusher.stop();

        expect(written).toHaveLength(1);
        expect(heartbeat.stalledFor(METRICS_FLUSH_HEARTBEAT)).toBeUndefined();
    });

    it('logs a gauge that cannot be read at debug, and samples the rest', async () => {
        const { flusher, recorder, written, logger } = harness();
        recorder.gauge('broken', () => {
            throw new Error('icecast is not answering');
        });
        recorder.gauge('fine', () => 1);

        await flusher.flush();

        expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('gauge broken could not be read'));
        expect(written[0]?.map(b => b.name)).toEqual(['fine']);
    });
});
