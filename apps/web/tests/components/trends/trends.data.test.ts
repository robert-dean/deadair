// The folding is where a chart can lie without looking wrong: a stretch nothing was measured drawn as a
// line across it, a stored point split between two bins, a bin's "latest" that is not the latest. Each
// of those is pinned here, against the shapes the station actually returns.

import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import type { MetricSeries } from '@deadair/sdk';

import { binSeries, binWidthMs, MAX_BINS, meanOf, rangeWindow, rank, total } from '../../../src/components/trends/trends.data';

const at = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' });
const point = (iso: string, value: number) => ({ at: at(iso), count: 1, sum: value, min: value, max: value, last: value });
const series = (labels: Record<string, string>, points: ReturnType<typeof point>[]): MetricSeries => ({
    name: 'm',
    labels,
    source: 'station',
    points,
});

describe('rangeWindow', () => {
    it('ends at the start of the next minute, so the minute in progress is included', () => {
        const { from, to } = rangeWindow('6h', at('2026-10-17T12:34:56Z'));

        expect(to.toISO()).toBe('2026-10-17T12:35:00.000Z');
        expect(from.toISO()).toBe('2026-10-17T06:35:00.000Z');
    });
});

describe('binWidthMs', () => {
    it('keeps a range to at most the bin limit, in whole stored units', () => {
        const from = at('2026-10-17T00:00:00Z');

        expect(binWidthMs(from, from.plus({ hours: 6 }), 'minute')).toBe(3 * 60_000);
        expect(binWidthMs(from, from.plus({ hours: 1 }), 'minute')).toBe(60_000);
        expect(binWidthMs(from, from.plus({ days: 30 }), 'hour')).toBe(6 * 3_600_000);
    });
});

describe('binSeries', () => {
    const from = at('2026-10-17T00:00:00Z');
    const to = from.plus({ hours: 6 });

    it('draws every bin of the window, leaving an empty stretch empty rather than joining across it', () => {
        const bins = binSeries([series({}, [point('2026-10-17T00:00:00Z', 1), point('2026-10-17T05:59:00Z', 2)])], from, to, 'minute');

        expect(bins).toHaveLength(MAX_BINS);
        expect(bins.filter(bin => bin.point !== undefined)).toHaveLength(2);
        expect(bins[1]?.point).toBeUndefined();
    });

    it('folds every label set of a metric into one bin, oldest first, so its last is the latest', () => {
        const bins = binSeries(
            [
                series({ q: 'a' }, [point('2026-10-17T00:02:00Z', 9)]),
                series({ q: 'b' }, [point('2026-10-17T00:00:00Z', 1), point('2026-10-17T00:01:00Z', 4)]),
            ],
            from,
            to,
            'minute',
        );

        expect(bins[0]?.point).toEqual({ count: 3, sum: 14, min: 1, max: 9, last: 9 });
    });

    it('drops a point outside the window rather than piling it onto an edge', () => {
        const bins = binSeries([series({}, [point('2026-10-16T23:00:00Z', 5)])], from, to, 'minute');

        expect(bins.every(bin => bin.point === undefined)).toBe(true);
    });
});

describe('total, meanOf and rank', () => {
    it('sums a whole range, and ranks label sets by where the time went', () => {
        const slow = series({ queue: 'slow' }, [point('2026-10-17T00:00:00Z', 900), point('2026-10-17T00:01:00Z', 100)]);
        const fast = series({ queue: 'fast' }, [point('2026-10-17T00:00:00Z', 50)]);

        expect(meanOf(total([slow]))).toBe(500);
        expect(meanOf(undefined)).toBeUndefined();
        expect(rank([fast, slow], 5).map(r => r.labels.queue)).toEqual(['slow', 'fast']);
        expect(rank([fast, slow], 1)).toHaveLength(1);
    });
});
