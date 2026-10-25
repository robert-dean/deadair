import type { MetricPoint, MetricResolution, MetricSeries } from '@deadair/sdk';
import { DateTime, Duration } from 'luxon';

/**
 * The metric names the Trends tab draws. The station's own list is `metric.names.ts` in the API; the
 * console cannot import it, so the few it charts are named here, and a rename there shows up as an
 * empty chart here rather than as a type error. That is the trade every console route makes.
 */
export const TREND_METRICS = {
    listeners: 'station.listeners',
    jobMs: 'work.job.ms',
    pluginMs: 'work.plugin.ms',
    failed: 'work.failed',
    modelMs: 'model.call.ms',
    modelInputTokens: 'model.tokens.input',
    modelOutputTokens: 'model.tokens.output',
    libraryTotal: 'library.tracks',
    libraryCached: 'library.cached',
    libraryMeasured: 'library.measured',
    diskBytes: 'storage.bytes',
} as const;

/** The ranges an operator can pick, shortest first. */
export const TREND_RANGES = ['6h', '24h', '7d', '30d', '1y'] as const;
export type TrendRange = (typeof TREND_RANGES)[number];

const RANGE_LENGTH: Record<TrendRange, Duration> = {
    '6h': Duration.fromObject({ hours: 6 }),
    '24h': Duration.fromObject({ hours: 24 }),
    '7d': Duration.fromObject({ days: 7 }),
    '30d': Duration.fromObject({ days: 30 }),
    '1y': Duration.fromObject({ days: 365 }),
};

/**
 * The most points one chart draws. A minute series over six hours is 360 points and a bar per point
 * is a hairline; folding into at most this many keeps every bar wide enough to hover.
 */
export const MAX_BINS = 120;

/** The window a range covers, ending at the start of the next minute so the minute in progress is included. */
export function rangeWindow(range: TrendRange, now: DateTime = DateTime.now()): { from: DateTime; to: DateTime } {
    const to = now.toUTC().startOf('minute').plus({ minutes: 1 });
    return { from: to.minus(RANGE_LENGTH[range]), to };
}

/** One folded stretch of a series: the five numbers, or nothing where nothing was measured. */
export interface Bin {
    at: DateTime;
    point?: Omit<MetricPoint, 'at'>;
}

const UNIT_MS: Record<MetricResolution, number> = { minute: 60_000, hour: 3_600_000 };

/**
 * How wide each bin is: the smallest whole multiple of the stored resolution that keeps the range to
 * {@link MAX_BINS} bins. Whole multiples, so a stored point never straddles two bins.
 */
export function binWidthMs(from: DateTime, to: DateTime, resolution: MetricResolution): number {
    const unit = UNIT_MS[resolution];
    const units = Math.ceil(to.diff(from).as('milliseconds') / unit / MAX_BINS);
    return Math.max(1, units) * unit;
}

const fold = (a: Omit<MetricPoint, 'at'> | undefined, b: Omit<MetricPoint, 'at'>): Omit<MetricPoint, 'at'> =>
    a === undefined
        ? { count: b.count, sum: b.sum, min: b.min, max: b.max, last: b.last }
        : { count: a.count + b.count, sum: a.sum + b.sum, min: Math.min(a.min, b.min), max: Math.max(a.max, b.max), last: b.last };

/**
 * Folds every series given (all the label sets of one metric, typically) into one row of bins across
 * the whole window.
 *
 * Every bin of the window is present, empty ones included, so a chart draws a stretch nothing was
 * measured as a gap rather than joining the points either side of it into a line that was never there.
 * Points are folded oldest first, so a bin's `last` is its latest reading.
 *
 * Bins start on a whole multiple of their width in `zone`, not at `from`: a window opened at 10:03
 * otherwise labels every bin of a week "10:03", "06:03", "02:03". The first bin may begin a little
 * before `from`, which costs nothing because the station returns no point from before it.
 */
export function binSeries(
    series: readonly MetricSeries[],
    from: DateTime,
    to: DateTime,
    resolution: MetricResolution,
    zone: string = 'local',
): Bin[] {
    const width = binWidthMs(from, to, resolution);
    const offset = from.setZone(zone).offset * 60_000;
    const start = Math.floor((from.toMillis() + offset) / width) * width - offset;
    const count = Math.ceil((to.toMillis() - start) / width);
    const bins: Bin[] = Array.from({ length: count }, (_, i) => ({ at: DateTime.fromMillis(start + i * width) }));

    const points = series.flatMap(s => s.points).sort((a, b) => a.at.toMillis() - b.at.toMillis());
    for (const point of points) {
        const index = Math.floor((point.at.toMillis() - start) / width);
        const bin = bins[index];
        if (bin === undefined) continue;
        bin.point = fold(bin.point, point);
    }
    return bins;
}

/**
 * How often the station reads each gauge it reads less than once a minute, from `station.gauges.ts`
 * in the API. Copied for the same reason {@link TREND_METRICS} is, and a change there that is not made
 * here draws the gauge broken up again rather than failing anything.
 */
export const GAUGE_EVERY_MS = {
    library: 5 * 60_000,
    disk: 15 * 60_000,
} as const;

/**
 * A gauge read every `everyMs`, held across the bins between its readings.
 *
 * A bin narrower than the gauge's interval is mostly empty, and an empty bin is drawn as a gap, so a
 * disk read every fifteen minutes on a range binned by three came out as a row of lone dots. A gauge's
 * reading stands until the next one, so an empty bin takes the last reading while the next is not yet
 * overdue. Half an interval of slack covers the sampler's drift (the library is read every five
 * minutes and lands five or six apart); a reading missed outright still leaves the gap, which is what
 * a station that was down should look like.
 */
export function holdGauge(bins: readonly Bin[], everyMs: number): Bin[] {
    let held: Bin | undefined;
    return bins.map(bin => {
        if (bin.point !== undefined) {
            held = bin;
            return bin;
        }
        if (held?.point === undefined || bin.at.toMillis() - held.at.toMillis() >= everyMs * 1.5) return bin;
        return { at: bin.at, point: held.point };
    });
}

/** Every point of the given series folded into one: a whole range summed up. */
export function total(series: readonly MetricSeries[]): Omit<MetricPoint, 'at'> | undefined {
    let folded: Omit<MetricPoint, 'at'> | undefined;
    for (const point of series.flatMap(s => s.points)) folded = fold(folded, point);
    return folded;
}

/** The mean of a folded stretch, or `undefined` for one with nothing in it. */
export const meanOf = (point: Omit<MetricPoint, 'at'> | undefined): number | undefined =>
    point === undefined || point.count === 0 ? undefined : point.sum / point.count;

/** One label set's whole-range total, for a ranking. */
export interface Ranked {
    labels: Record<string, string>;
    point: Omit<MetricPoint, 'at'>;
}

/**
 * Each series of a metric summed over the whole range, largest total first, at most `limit` of them.
 * For a duration the total is the time spent, so the first row is where the station's time went.
 */
export function rank(series: readonly MetricSeries[], limit: number): Ranked[] {
    return series
        .map(s => ({ labels: s.labels, point: total([s]) }))
        .filter((r): r is Ranked => r.point !== undefined)
        .sort((a, b) => b.point.sum - a.point.sum)
        .slice(0, limit);
}

/** The series of one metric, out of a page holding several. */
export const named = (series: readonly MetricSeries[] | undefined, name: string): MetricSeries[] => (series ?? []).filter(s => s.name === name);
