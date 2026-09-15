import type { SdkFetch } from '../sdk-options.js';
import { parseJson, buildQueryString } from '../sdk-options.js';
import type { StationEpisodePage, StationEpisodeQuery, StationShowList } from './types/podcasts.types.js';

export class PodcastsClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name List shows
     * @description Every programme every installed podcast plugin carries
     */
    async listShows(): Promise<StationShowList> {
        const result = await this.fetch(`/podcasts/shows`, { method: 'GET' });
        return await parseJson<StationShowList>(result);
    }

    /**
     * @name List episodes
     * @description The episodes the station knows about, newest first, with what it has done with each
     */
    async listEpisodes(query?: StationEpisodeQuery): Promise<StationEpisodePage> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/podcasts/episodes${qs}`, {
            method: 'GET',
        });
        return await parseJson<StationEpisodePage>(result);
    }

    /**
     * @name Refresh podcasts
     * @description Reads every show's feed again, in the background, rather than waiting for the next scheduled refresh
     */
    async refreshPodcasts(): Promise<void> {
        await this.fetch(`/podcasts/refresh`, { method: 'POST' });
    }
}
