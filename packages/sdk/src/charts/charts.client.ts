import type { SdkFetch } from '../sdk-options.js';
import { parseJson, buildQueryString } from '../sdk-options.js';
import type { ChartPage, ChartQuery, StationChartList } from './types/charts.types.js';

export class ChartsClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name List charts
     * @description Every chart every installed chart plugin currently offers
     */
    async listCharts(): Promise<StationChartList> {
        const result = await this.fetch(`/charts`, { method: 'GET' });
        return await parseJson<StationChartList>(result);
    }

    /**
     * @name Read chart
     * @description One chart's records, ranked
     */
    async readChart(id: string, query?: ChartQuery): Promise<ChartPage> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/charts/${encodeURIComponent(id)}${qs}`, {
            method: 'GET',
        });
        return await parseJson<ChartPage>(result);
    }
}
