import { z } from 'zod';

/**
 * A chart one installed plugin offers
 * generated from [StationChart](../../../../data/contracts/charts/charts.types.ck#L7)
 */
export const StationChart = z.strictObject({
    id: z
        .string()
        .min(1)
        .max(400)
        .describe(
            "Unique across the station: the plugin's own id for the chart, qualified with the plugin that offered it. Two services both calling something `top-100` stay distinct",
        ),
    pluginId: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    country: z.string().max(10).optional().describe('ISO 3166-1 alpha-2, when the chart is national. Absent means global'),
    genre: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
});
export type StationChart = z.infer<typeof StationChart>;

/**
 * One record's place in a chart
 * generated from [ChartRecord](../../../../data/contracts/charts/charts.types.ck#L20)
 */
export const ChartRecord = z.strictObject({
    rank: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1)),
    title: z.string().min(1).max(400),
    artist: z.string().min(1).max(200).describe('The lead artist alone. The other credits are in `featuring`'),
    featuring: z.array(z.string().min(1).max(200)).optional(),
    album: z.string().max(400).optional(),
    year: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0)).optional(),
    peak: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1))
        .optional()
        .describe('Best position this record has reached, where the source tracks it'),
    weeksOn: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .optional()
        .describe('How many editions it has appeared in, where the source tracks it'),
});
export type ChartRecord = z.infer<typeof ChartRecord>;

/**
 * generated from [ChartQuery](../../../../data/contracts/charts/charts.types.ck#L31)
 */
export const ChartQuery = z.strictObject({
    limit: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1).max(100)).optional(),
    date: z
        .string()
        .max(10)
        .optional()
        .describe(
            'Which edition, as `YYYY-MM-DD`. Absent means the current one, and a service that keeps no history answers with the current one either way',
        ),
});
export type ChartQuery = z.infer<typeof ChartQuery>;

/**
 * generated from [StationChartList](../../../../data/contracts/charts/charts.types.ck#L16)
 */
export const StationChartList = z.strictObject({
    charts: z.array(StationChart),
});
export type StationChartList = z.infer<typeof StationChartList>;

/**
 * generated from [ChartPage](../../../../data/contracts/charts/charts.types.ck#L36)
 */
export const ChartPage = z.strictObject({
    chartId: z.string().min(1).max(400),
    records: z
        .array(ChartRecord)
        .describe(
            'Ranked. Empty when the chart could not be read, which is deliberately not an error: a chart is something to look at, never something the station needs to air',
        ),
});
export type ChartPage = z.infer<typeof ChartPage>;
