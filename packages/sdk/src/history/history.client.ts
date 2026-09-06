import type { SdkFetch } from '../sdk-options.js';
import { parseJson, buildQueryString } from '../sdk-options.js';
import type { HistoryPage, HistoryQuery } from './types/history.types.js';
import { reviveHistoryPage } from './types/history.types.js';

export class HistoryClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name Read history
     * @description What the station played, newest first, one page at a time
     */
    async readHistory(query?: HistoryQuery): Promise<HistoryPage> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/history${qs}`, {
            method: 'GET',
        });
        return reviveHistoryPage(await parseJson<HistoryPage>(result));
    }
}
