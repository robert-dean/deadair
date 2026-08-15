import type { SdkFetch } from '../sdk-options.js';
import { parseJson, buildQueryString } from '../sdk-options.js';
import type { NewsPage, NewsQuery, StationFeedList } from './types/news.types.js';

export class NewsClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name List feeds
     * @description Every feed every installed news plugin currently offers
     */
    async listFeeds(): Promise<StationFeedList> {
        const result = await this.fetch(`/news/feeds`, { method: 'GET' });
        return await parseJson<StationFeedList>(result);
    }

    /**
     * @name Read news
     * @description Published entries, newest first
     */
    async readNews(query?: NewsQuery): Promise<NewsPage> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/news${qs}`, {
            method: 'GET',
        });
        return await parseJson<NewsPage>(result);
    }
}
