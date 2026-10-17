import type { SdkFetch } from '../sdk-options.js';
import { parseJson, buildQueryString } from '../sdk-options.js';
import type { MetricNames, MetricSeriesPage, MetricSeriesQuery } from './types/metrics.types.js';
import { reviveMetricNames, reviveMetricSeriesPage } from './types/metrics.types.js';

export class MetricsClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name Read metric series
     * @description Trends over a range, at minute resolution for two days or less and hourly beyond
     */
    async readMetricSeries(query?: MetricSeriesQuery): Promise<MetricSeriesPage> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/metrics/series${qs}`, {
            method: 'GET',
        });
        return reviveMetricSeriesPage(await parseJson<MetricSeriesPage>(result));
    }

    /**
     * @name Read metric names
     * @description Every metric the station holds, with its labels and when it was last measured
     */
    async readMetricNames(): Promise<MetricNames> {
        const result = await this.fetch(`/metrics/names`, { method: 'GET' });
        return reviveMetricNames(await parseJson<MetricNames>(result));
    }
}
