/**
 * A chart one installed plugin offers
 * generated from [StationChart](../../../../../apps/api/data/contracts/charts/charts.types.ck#L7)
 */
export interface StationChart {
    /** Unique across the station: the plugin's own id for the chart, qualified with the plugin that offered it. Two services both calling something `top-100` stay distinct */
    id: string;
    pluginId: string;
    name: string;
    /** ISO 3166-1 alpha-2, when the chart is national. Absent means global */
    country?: string;
    genre?: string;
    description?: string;
}

/**
 * One record's place in a chart
 * generated from [ChartRecord](../../../../../apps/api/data/contracts/charts/charts.types.ck#L20)
 */
export interface ChartRecord {
    rank: number;
    title: string;
    /** The lead artist alone. The other credits are in `featuring` */
    artist: string;
    featuring?: string[];
    album?: string;
    year?: number;
    /** Best position this record has reached, where the source tracks it */
    peak?: number;
    /** How many editions it has appeared in, where the source tracks it */
    weeksOn?: number;
}

/**
 * generated from [ChartQuery](../../../../../apps/api/data/contracts/charts/charts.types.ck#L31)
 */
export interface ChartQuery {
    limit?: number;
    /** Which edition, as `YYYY-MM-DD`. Absent means the current one, and a service that keeps no history answers with the current one either way */
    date?: string;
}

/**
 * generated from [StationChartList](../../../../../apps/api/data/contracts/charts/charts.types.ck#L16)
 */
export interface StationChartList {
    charts: StationChart[];
}

/**
 * generated from [ChartPage](../../../../../apps/api/data/contracts/charts/charts.types.ck#L36)
 */
export interface ChartPage {
    chartId: string;
    /** Ranked. Empty when the chart could not be read, which is deliberately not an error: a chart is something to look at, never something the station needs to air */
    records: ChartRecord[];
}
