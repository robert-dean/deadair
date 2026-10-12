import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson, buildQueryString } from '../sdk-options.js';
import type { Production, ProductionList } from '../productions/types/productions.types.js';
import { reviveProduction, reviveProductionList } from '../productions/types/productions.types.js';
import type {
    OwnEpisodeRequest,
    OwnShow,
    OwnShowInput,
    OwnShowList,
    StationDirectoryPage,
    StationDirectoryQuery,
    StationEpisode,
    StationEpisodePage,
    StationEpisodeQuery,
    StationShowList,
} from './types/podcasts.types.js';
import { reviveOwnShow, reviveOwnShowList } from './types/podcasts.types.js';

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
     * @name Search podcast directory
     * @description Looks a show up in the directories the installed podcast plugins can search
     */
    async searchPodcastDirectory(query?: StationDirectoryQuery): Promise<StationDirectoryPage> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/podcasts/search${qs}`, {
            method: 'GET',
        });
        return await parseJson<StationDirectoryPage>(result);
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
     * @name Fetch episode
     * @description Fetches one episode's audio into the station's store now, rather than waiting for its slot to come near
     */
    async fetchEpisode(id: string): Promise<StationEpisode> {
        const result = await this.fetch(`/podcasts/episodes/${encodeURIComponent(id)}/fetch`, { method: 'POST' });
        return await parseJson<StationEpisode>(result);
    }

    /**
     * @name Refresh podcasts
     * @description Reads every show's feed again, in the background, rather than waiting for the next scheduled refresh
     */
    async refreshPodcasts(): Promise<void> {
        await this.fetch(`/podcasts/refresh`, { method: 'POST' });
    }

    /**
     * @name List own shows
     * @description The shows the station makes for itself
     */
    async listOwnShows(): Promise<OwnShowList> {
        const result = await this.fetch(`/podcasts/own`, { method: 'GET' });
        return reviveOwnShowList(await parseJson<OwnShowList>(result));
    }

    /**
     * @name Create own show
     * @description Makes a new show. Nothing is made until an episode is asked for
     */
    async createOwnShow(body: OwnShowInput): Promise<OwnShow> {
        const result = await this.fetch(`/podcasts/own`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return reviveOwnShow(await parseJson<OwnShow>(result));
    }

    /**
     * @name Update own show
     * @description Rewrites a show. Episodes already asked for keep what they were asked with
     */
    async updateOwnShow(id: string, body: OwnShowInput): Promise<OwnShow> {
        const result = await this.fetch(`/podcasts/own/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return reviveOwnShow(await parseJson<OwnShow>(result));
    }

    /**
     * @name Delete own show
     * @description Removes a show. Its episodes stay on the Productions page, no longer filed under it
     */
    async deleteOwnShow(id: string): Promise<void> {
        await this.fetch(`/podcasts/own/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }

    /**
     * @name List own show episodes
     * @description A show's episodes, newest first, with how far along each is
     */
    async listOwnShowEpisodes(id: string): Promise<ProductionList> {
        const result = await this.fetch(`/podcasts/own/${encodeURIComponent(id)}/episodes`, { method: 'GET' });
        return reviveProductionList(await parseJson<ProductionList>(result));
    }

    /**
     * @name Request own show episode
     * @description Asks the show for an episode. It is queued, not started, and airs when it is made or at the time given
     */
    async requestOwnShowEpisode(id: string, body: OwnEpisodeRequest): Promise<Production> {
        const result = await this.fetch(`/podcasts/own/${encodeURIComponent(id)}/episodes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return reviveProduction(await parseJson<Production>(result));
    }
}
