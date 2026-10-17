// The read route's whole job is to choose a resolution the caller cannot, and to refuse a read the
// table could not answer sensibly. Both are pinned here: the 48-hour edge, and every refusal.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';

import { MAX_RANGE_DAYS, MAX_SERIES_NAMES, MetricsService } from '../../../src/modules/metrics/metrics.service.js';

const from = DateTime.utc(2026, 10, 1);

function harness() {
    const metrics = {
        series: vi.fn(async () => [
            {
                name: 'station.listeners',
                labels: {},
                labelsKey: '{}',
                source: 'station',
                points: [{ start: from, aggregate: { count: 1, sum: 2, min: 2, max: 2, last: 2 } }],
            },
        ]),
        names: vi.fn(async () => [{ name: 'station.listeners', source: 'station', labelKeys: [], lastSeen: from }]),
    };
    return { service: new MetricsService(metrics as never), metrics };
}

describe('MetricsService.readSeries', () => {
    it('reads two days or less in minutes and anything longer in hours', async () => {
        const { service, metrics } = harness();

        expect((await service.readSeries({ names: 'a', from, to: from.plus({ hours: 48 }) })).resolution).toBe('minute');
        expect((await service.readSeries({ names: 'a', from, to: from.plus({ hours: 48, minutes: 1 }) })).resolution).toBe('hour');
        expect(metrics.series).toHaveBeenLastCalledWith(expect.objectContaining({ resolution: 'hour' }));
    });

    it('splits, trims and de-duplicates the names, and answers each point at its bucket start', async () => {
        const { service, metrics } = harness();

        const page = await service.readSeries({ names: ' station.listeners, work.job.ms ,station.listeners,', from, to: from.plus({ hours: 6 }) });

        expect(metrics.series).toHaveBeenCalledWith(expect.objectContaining({ names: ['station.listeners', 'work.job.ms'] }));
        expect(page.series[0]?.points[0]).toEqual({ at: from, count: 1, sum: 2, min: 2, max: 2, last: 2 });
    });

    it.each([
        ['no names at all', { names: ' , ', to: from.plus({ hours: 1 }) }],
        ['too many names', { names: Array.from({ length: MAX_SERIES_NAMES + 1 }, (_, i) => `m${i}`).join(','), to: from.plus({ hours: 1 }) }],
        ['a range that ends before it starts', { names: 'a', to: from.minus({ minutes: 1 }) }],
        ['an empty range', { names: 'a', to: from }],
        ['a range longer than the hour rows are kept', { names: 'a', to: from.plus({ days: MAX_RANGE_DAYS + 1 }) }],
    ])('refuses %s with a 400', async (_, query) => {
        const { service, metrics } = harness();

        await expect(service.readSeries({ from, ...query })).rejects.toMatchObject({ statusCode: 400 });
        expect(metrics.series).not.toHaveBeenCalled();
    });
});

describe('MetricsService.readNames', () => {
    it('answers every name the station holds', async () => {
        const { service } = harness();

        expect((await service.readNames()).names.map(n => n.name)).toEqual(['station.listeners']);
    });
});
