import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * How wide one point is. Chosen by the station from the range asked for: minutes for two days or less, hours beyond
 * generated from [MetricResolution](../../../../data/contracts/metrics/metrics.types.ck)
 */
export const MetricResolution = z.enum(['minute', 'hour']);
export type MetricResolution = z.infer<typeof MetricResolution>;

/**
 * The trends to read, over one range
 * generated from [MetricSeriesQuery](../../../../data/contracts/metrics/metrics.types.ck)
 */
export const MetricSeriesQuery = z.strictObject({
    names: z.string().min(1).max(1000).describe('Comma-separated metric names, at most twenty: `station.listeners,work.job.ms`'),
    from: _ZodDatetime.describe('The start of the range, inclusive'),
    to: _ZodDatetime.describe('The end of the range, exclusive. At most four hundred days after `from`'),
});
export type MetricSeriesQuery = z.infer<typeof MetricSeriesQuery>;

/**
 * One series over one minute or hour
 * generated from [MetricPoint](../../../../data/contracts/metrics/metrics.types.ck)
 */
export const MetricPoint = z.strictObject({
    at: _ZodDatetime.describe('The start of the minute or hour'),
    count: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().min(0))
        .describe('How many observations were folded in'),
    sum: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number())
        .describe("Their total: a counter's value, or with `count` a duration's mean"),
    min: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number()).describe('The smallest observation'),
    max: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number())
        .describe("The largest observation: a duration's worst"),
    last: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number())
        .describe("The latest observation: a gauge's value"),
});
export type MetricPoint = z.infer<typeof MetricPoint>;

/**
 * A metric the station holds, for a picker
 * generated from [MetricName](../../../../data/contracts/metrics/metrics.types.ck)
 */
export const MetricName = z.strictObject({
    name: z.string().min(1).max(200),
    source: z.string().min(1).max(50),
    labelKeys: z.array(z.string().min(1).max(200)).describe('Every label any of its series carries, sorted'),
    lastSeen: _ZodDatetime.describe('The newest point held for it, at either resolution'),
});
export type MetricName = z.infer<typeof MetricName>;

/**
 * An OTLP/HTTP metrics export, sent as JSON. Only the top level is checked here; the station reads the rest itself and counts what it cannot use rather than refusing the whole request
 * generated from [OtlpMetricsExport](../../../../data/contracts/metrics/metrics.types.ck)
 */
export const OtlpMetricsExport = z.looseObject({
    resourceMetrics: z.array(z.record(z.string(), z.unknown())).max(1000),
});
export type OtlpMetricsExport = z.infer<typeof OtlpMetricsExport>;

/**
 * OTLP's answer when some points were not taken
 * generated from [OtlpPartialSuccess](../../../../data/contracts/metrics/metrics.types.ck)
 */
export const OtlpPartialSuccess = z.strictObject({
    rejectedDataPoints: z.string().describe('How many, as OTLP writes a 64-bit count: a digit string'),
    errorMessage: z.string().max(500),
});
export type OtlpPartialSuccess = z.infer<typeof OtlpPartialSuccess>;

/**
 * One metric and one set of labels, its points oldest first
 * generated from [MetricSeries](../../../../data/contracts/metrics/metrics.types.ck)
 */
export const MetricSeries = z.strictObject({
    name: z.string().min(1).max(200),
    labels: z
        .record(z.string(), z.string())
        .describe('What tells this series from the metric\'s others: `{ "queue": "catalog.sync" }`. Empty for a metric with one series'),
    source: z.string().min(1).max(50).describe('`station` for what the station measured itself, `otlp` for what another service sent it'),
    points: z
        .array(MetricPoint)
        .describe('Only the buckets that hold something. A gap is a stretch nothing was measured, which a chart should draw as a gap'),
});
export type MetricSeries = z.infer<typeof MetricSeries>;

/**
 * generated from [MetricNames](../../../../data/contracts/metrics/metrics.types.ck)
 */
export const MetricNames = z.strictObject({
    names: z.array(MetricName).describe('Sorted by name'),
});
export type MetricNames = z.infer<typeof MetricNames>;

/**
 * OTLP's answer to an export. Empty when every point was taken
 * generated from [OtlpExportResponse](../../../../data/contracts/metrics/metrics.types.ck)
 */
export const OtlpExportResponse = z.strictObject({
    partialSuccess: OtlpPartialSuccess.optional(),
});
export type OtlpExportResponse = z.infer<typeof OtlpExportResponse>;

/**
 * generated from [MetricSeriesPage](../../../../data/contracts/metrics/metrics.types.ck)
 */
export const MetricSeriesPage = z.strictObject({
    resolution: MetricResolution.describe('The width the points were read at'),
    from: _ZodDatetime,
    to: _ZodDatetime,
    series: z.array(MetricSeries).describe('Empty when nothing was measured in the range, which is not an error'),
});
export type MetricSeriesPage = z.infer<typeof MetricSeriesPage>;
