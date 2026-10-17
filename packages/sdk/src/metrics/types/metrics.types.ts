import { DateTime } from 'luxon';
const __dt = (v: unknown, path: string): DateTime => {
    if (typeof v !== 'string') {
        throw new TypeError(`ContractKit: expected an ISO 8601 string at '${path}', received ${typeof v}.`);
    }
    const d = DateTime.fromISO(v);
    if (!d.isValid) throw new TypeError(`ContractKit: '${v}' at '${path}' is not a valid ISO 8601 datetime.`);
    return d;
};

/**
 * How wide one point is. Chosen by the station from the range asked for: minutes for two days or less, hours beyond
 * generated from [MetricResolution](../../../../../apps/api/data/contracts/metrics/metrics.types.ck)
 */
export type MetricResolution = 'minute' | 'hour';

/**
 * The trends to read, over one range
 * generated from [MetricSeriesQuery](../../../../../apps/api/data/contracts/metrics/metrics.types.ck)
 */
export interface MetricSeriesQuery {
    /** Comma-separated metric names, at most twenty: `station.listeners,work.job.ms` */
    names: string;
    /** The start of the range, inclusive */
    from: DateTime;
    /** The end of the range, exclusive. At most four hundred days after `from` */
    to: DateTime;
}

/** Rehydrates every wire-encoded scalar in a MetricSeriesQuery into its runtime type. Mutates and returns `raw`. */
export function reviveMetricSeriesQuery(raw: MetricSeriesQuery): MetricSeriesQuery {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['from'] = __dt(__o0['from'], 'MetricSeriesQuery.from');
    __o0['to'] = __dt(__o0['to'], 'MetricSeriesQuery.to');
    return raw;
}

/**
 * One series over one minute or hour
 * generated from [MetricPoint](../../../../../apps/api/data/contracts/metrics/metrics.types.ck)
 */
export interface MetricPoint {
    /** The start of the minute or hour */
    at: DateTime;
    /** How many observations were folded in */
    count: number;
    /** Their total: a counter's value, or with `count` a duration's mean */
    sum: number;
    /** The smallest observation */
    min: number;
    /** The largest observation: a duration's worst */
    max: number;
    /** The latest observation: a gauge's value */
    last: number;
}

/** Rehydrates every wire-encoded scalar in a MetricPoint into its runtime type. Mutates and returns `raw`. */
export function reviveMetricPoint(raw: MetricPoint): MetricPoint {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['at'] = __dt(__o0['at'], 'MetricPoint.at');
    return raw;
}

/**
 * A metric the station holds, for a picker
 * generated from [MetricName](../../../../../apps/api/data/contracts/metrics/metrics.types.ck)
 */
export interface MetricName {
    name: string;
    source: string;
    /** Every label any of its series carries, sorted */
    labelKeys: string[];
    /** The newest point held for it, at either resolution */
    lastSeen: DateTime;
}

/** Rehydrates every wire-encoded scalar in a MetricName into its runtime type. Mutates and returns `raw`. */
export function reviveMetricName(raw: MetricName): MetricName {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['lastSeen'] = __dt(__o0['lastSeen'], 'MetricName.lastSeen');
    return raw;
}

/**
 * An OTLP/HTTP metrics export, sent as JSON. Only the top level is checked here; the station reads the rest itself and counts what it cannot use rather than refusing the whole request
 * generated from [OtlpMetricsExport](../../../../../apps/api/data/contracts/metrics/metrics.types.ck)
 */
export interface OtlpMetricsExport {
    resourceMetrics: Record<string, unknown>[];
}

/**
 * OTLP's answer when some points were not taken
 * generated from [OtlpPartialSuccess](../../../../../apps/api/data/contracts/metrics/metrics.types.ck)
 */
export interface OtlpPartialSuccess {
    /** How many, as OTLP writes a 64-bit count: a digit string */
    rejectedDataPoints: string;
    errorMessage: string;
}

/**
 * One metric and one set of labels, its points oldest first
 * generated from [MetricSeries](../../../../../apps/api/data/contracts/metrics/metrics.types.ck)
 */
export interface MetricSeries {
    name: string;
    /** What tells this series from the metric's others: `{ "queue": "catalog.sync" }`. Empty for a metric with one series */
    labels: Record<string, string>;
    /** `station` for what the station measured itself, `otlp` for what another service sent it */
    source: string;
    /** Only the buckets that hold something. A gap is a stretch nothing was measured, which a chart should draw as a gap */
    points: MetricPoint[];
}

/** Rehydrates every wire-encoded scalar in a MetricSeries into its runtime type. Mutates and returns `raw`. */
export function reviveMetricSeries(raw: MetricSeries): MetricSeries {
    const __o0 = raw as unknown as Record<string, unknown>;
    {
        const __a1 = __o0['points'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveMetricPoint(__a1[__i2] as never);
        }
    }
    return raw;
}

/**
 * generated from [MetricNames](../../../../../apps/api/data/contracts/metrics/metrics.types.ck)
 */
export interface MetricNames {
    /** Sorted by name */
    names: MetricName[];
}

/** Rehydrates every wire-encoded scalar in a MetricNames into its runtime type. Mutates and returns `raw`. */
export function reviveMetricNames(raw: MetricNames): MetricNames {
    const __o0 = raw as unknown as Record<string, unknown>;
    {
        const __a1 = __o0['names'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveMetricName(__a1[__i2] as never);
        }
    }
    return raw;
}

/**
 * OTLP's answer to an export. Empty when every point was taken
 * generated from [OtlpExportResponse](../../../../../apps/api/data/contracts/metrics/metrics.types.ck)
 */
export interface OtlpExportResponse {
    partialSuccess?: OtlpPartialSuccess;
}

/**
 * generated from [MetricSeriesPage](../../../../../apps/api/data/contracts/metrics/metrics.types.ck)
 */
export interface MetricSeriesPage {
    /** The width the points were read at */
    resolution: MetricResolution;
    from: DateTime;
    to: DateTime;
    /** Empty when nothing was measured in the range, which is not an error */
    series: MetricSeries[];
}

/** Rehydrates every wire-encoded scalar in a MetricSeriesPage into its runtime type. Mutates and returns `raw`. */
export function reviveMetricSeriesPage(raw: MetricSeriesPage): MetricSeriesPage {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['from'] = __dt(__o0['from'], 'MetricSeriesPage.from');
    __o0['to'] = __dt(__o0['to'], 'MetricSeriesPage.to');
    {
        const __a1 = __o0['series'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveMetricSeries(__a1[__i2] as never);
        }
    }
    return raw;
}
