import type { SdkFetch } from '../sdk-options.js';
import { parseJson, buildQueryString } from '../sdk-options.js';
import type { AsRunPage, AsRunQuery, HistoryPage, HistoryQuery } from './types/history.types.js';
import { reviveAsRunPage, reviveHistoryPage } from './types/history.types.js';

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

    /**
     * @name Read as-run log
     * @description The as-run log, newest first, one page at a time
     */
    async readAsRunLog(query?: AsRunQuery): Promise<AsRunPage> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/history/as-run${qs}`, {
            method: 'GET',
        });
        return reviveAsRunPage(await parseJson<AsRunPage>(result));
    }
}
