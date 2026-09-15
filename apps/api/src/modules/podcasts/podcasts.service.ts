import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import type { PodcastDirectoryEntry, PodcastEpisode, PodcastShow } from '@deadair/plugin-sdk';
import { asPodcastPlugin, type PodcastPlugin } from '#modules/plugins/plugin.capabilities.js';
import { byPluginId, pluginsWith } from '#modules/plugins/plugin.selection.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { errorText } from '#modules/shared/error.text.js';
import type { PodcastEpisodeListing, PodcastEpisodeRecord } from './podcast.episode.js';
import { PodcastEpisodeRepository } from './podcast.episode.repository.js';
import { FETCH_RETRY_AFTER_MS } from './podcast.fetch.service.js';
import { qualifyShowId } from './show.ids.js';
import type {
    StationDirectoryEntry,
    StationDirectoryPage,
    StationDirectoryQuery,
    StationEpisode,
    StationEpisodePage,
    StationEpisodeQuery,
    StationShow,
    StationShowList,
} from './types/podcasts.types.js';

/**
 * How long a plugin is given to say what it carries, when somebody is waiting on the answer.
 *
 * Listing shows reads every feed on the plugin's list, and the plugin stops READING (not listing)
 * once its budget runs low, describing the rest from what it already knows. So a short budget costs a
 * page some descriptions rather than some shows, and ten seconds is what a console page can wait.
 */
export const LIST_SHOWS_TIMEOUT_MS = 10_000;

/**
 * The same, for a refresh nobody is waiting on. Long enough to read a station's whole list of feeds
 * fresh, which is the point of a refresh.
 */
export const REFRESH_LIST_SHOWS_TIMEOUT_MS = 60_000;

/**
 * How long a plugin is given for one show's episodes.
 *
 * One feed, which for a long-running show is several megabytes of somebody else's origin server; the
 * plugin's own per-request ceiling is fifteen seconds and this leaves room to parse what came back.
 */
export const LIST_EPISODES_TIMEOUT_MS = 30_000;

/**
 * How many of a show's newest episodes a refresh asks for.
 *
 * A station carries the NEWEST episode of a show at a slot, so what matters is that the newest are
 * known. Twenty-five covers a daily show's month and a weekly show's half year, and every one of them
 * is a row the console lists; a feed's whole back catalogue would be hundreds of rows nobody asked for.
 */
export const REFRESH_EPISODES_PER_SHOW = 25;

/** What the console is given when it asks for episodes and says nothing about how many. */
export const DEFAULT_EPISODE_PAGE = 50;

/** How many directory results the console is given when it says nothing about how many. */
export const DEFAULT_DIRECTORY_RESULTS = 20;

/**
 * How long a directory is given to answer. An operator is waiting on it, and a directory that is slow
 * is a convenience missing rather than a feature broken.
 */
export const SEARCH_DIRECTORY_TIMEOUT_MS = 10_000;

/** What one refresh did, for the job's log line. */
export interface PodcastRefreshSummary {
    /** Shows every plugin said it carries. */
    shows: number;
    /** Episodes listed across all of them. */
    listed: number;
    /** Of those, how many the station had never seen. */
    added: number;
    /** Shows whose episodes could not be listed, qualified. */
    failed: string[];
}

/**
 * Somebody else's programmes, as the station can see them: every show every installed podcast plugin
 * carries, under ids that say which plugin carries it, and the episodes of them the station knows.
 *
 * ## A list of subscriptions, not a merge
 *
 * `NewsService`'s rule: two plugins carrying shows are two sets of subscriptions, so this enumerates
 * and never combines, and there is no `priority` on the capability. The same feed subscribed twice
 * through two plugins is two shows, which is the operator's to tidy and not the station's to guess.
 *
 * ## The plugin describes, the station remembers
 *
 * A plugin is asked what a feed published; this module keeps what the station DID with each episode,
 * in its own table. That split is what lets a refresh be an upsert that can never erase an aired mark:
 * see `PodcastEpisodeRepository.record`.
 *
 * ## A plugin that cannot answer contributes nothing
 *
 * Every call into a plugin is caught and logged rather than thrown, the rule `NewsService` and
 * `ChartsService` apply: a publisher being down costs its own show and not the station's whole list.
 */
@Injectable()
export class PodcastsService {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly episodes: PodcastEpisodeRepository,
        private readonly jobs: PgBossJobBroker,
        private readonly logger: Logger,
    ) {}

    /** Whether anything can answer at all, for a caller deciding whether to offer the feature. */
    hasPodcasts(): boolean {
        return this.plugins().length > 0;
    }

    /** {@link listShows} as the console reads it. */
    async readShows(): Promise<StationShowList> {
        return { shows: await this.listShows() };
    }

    /**
     * Every show on offer, with its id qualified by the plugin that carries it.
     *
     * Ordered by plugin and then in the plugin's own order, which is the operator's: a list of
     * subscriptions is in the order somebody wrote it, and re-sorting by title would throw that away.
     */
    async listShows(timeoutMs = LIST_SHOWS_TIMEOUT_MS): Promise<StationShow[]> {
        const shows: StationShow[] = [];

        for (const plugin of this.plugins()) {
            let carried: PodcastShow[] | undefined;
            try {
                carried = await this.pluginInvoker.invoke(plugin.record.id, 'podcast.listShows', async () => plugin.instance.listShows(), {
                    timeoutMs,
                });
            } catch (error) {
                this.logger.info(`podcasts: a plugin could not say what it carries (${plugin.record.id}: ${errorText(error)})`);
                continue;
            }

            for (const show of carried ?? []) {
                if (!show?.id || !show.title) continue;
                shows.push(toStationShow(plugin.record.id, show));
            }
        }

        return shows;
    }

    /**
     * The episodes the station knows about, as the console reads them.
     *
     * Read from the station's own table and never from a plugin, so the page answers at once and
     * shows what the station actually holds: an episode a refresh has not reached yet is not one the
     * station knows about, and saying so is the truth.
     */
    async readEpisodes(query: StationEpisodeQuery): Promise<StationEpisodePage> {
        const rows = await this.episodes.list({
            ...(query.showId === undefined ? {} : { showId: query.showId }),
            limit: query.limit ?? DEFAULT_EPISODE_PAGE,
        });

        return { episodes: rows.map(toStationEpisode) };
    }

    /**
     * Look a show up in every directory an installed podcast plugin can search.
     *
     * Each result is tagged with the plugin whose directory answered, because that is where a
     * subscription to it would go: what a subscription IS belongs to each plugin, so the console
     * writes it into that plugin's own settings rather than this module reaching into them. A result
     * the station already carries is left to the console to mark, from the shows it has already read,
     * rather than costing every search a read of every feed.
     *
     * A directory that fails costs its own results, `NewsService`'s rule again.
     */
    async searchDirectory(query: StationDirectoryQuery): Promise<StationDirectoryPage> {
        const words = query.query.trim();
        const limit = query.limit ?? DEFAULT_DIRECTORY_RESULTS;
        if (words.length === 0) return { results: [] };

        const results: StationDirectoryEntry[] = [];
        for (const plugin of this.plugins()) {
            if (!plugin.searchesShows) continue;

            let found: PodcastDirectoryEntry[] | undefined;
            try {
                found = await this.pluginInvoker.invoke(
                    plugin.record.id,
                    'podcast.searchShows',
                    async () => plugin.instance.searchShows?.({ query: words, limit }),
                    {
                        timeoutMs: SEARCH_DIRECTORY_TIMEOUT_MS,
                    },
                );
            } catch (error) {
                this.logger.info(`podcasts: a directory could not be searched (${plugin.record.id}: ${errorText(error)})`);
                continue;
            }

            for (const entry of found ?? []) {
                if (!entry?.id || !entry.title || !isWebAddress(entry.feedUrl)) continue;
                results.push(toDirectoryEntry(plugin.record.id, entry));
            }
        }

        return { results: results.slice(0, limit) };
    }

    /**
     * Ask for a refresh in the background.
     *
     * A job rather than the work inline, because a refresh reads every feed on every plugin's list and
     * a long-running show's feed is megabytes: minutes, on a station with a few dozen subscriptions,
     * which no request should hold open. The console asks and reads the episodes again shortly after.
     */
    async requestRefresh(): Promise<void> {
        await this.jobs.send('podcasts.refresh', {});
    }

    /**
     * Ask for one episode's audio now, and answer with the episode as it then stands.
     *
     * Idempotent through the row rather than through the caller's restraint: an episode already held
     * is answered as it is, and one somebody asked for within {@link FETCH_RETRY_AFTER_MS} is not asked
     * for again, so an operator pressing the button twice queues one download. The claim and the send
     * commit together with the request, so a job is never sent for a claim that did not stick.
     */
    async requestFetch(id: string): Promise<StationEpisode> {
        const episode = await this.episodes.get(id);
        if (episode === undefined) throw httpError(404).withDetails({ message: 'the station does not know that episode' });

        if (episode.segmentId === undefined && (await this.episodes.claimFetch(id, Date.now(), FETCH_RETRY_AFTER_MS))) {
            await this.jobs.send('podcasts.fetch', { episodeId: id });
        }

        return toStationEpisode((await this.episodes.get(id)) ?? episode);
    }

    /**
     * Read every show's newest episodes and remember them.
     *
     * One show at a time, so a failing show costs itself and the rest are still written. Stops early,
     * between shows, when the job is being abandoned, rather than starting a read nobody will keep.
     */
    async refresh(signal?: AbortSignal): Promise<PodcastRefreshSummary> {
        const summary: PodcastRefreshSummary = { shows: 0, listed: 0, added: 0, failed: [] };

        for (const plugin of this.plugins()) {
            if (signal?.aborted) break;

            let shows: PodcastShow[];
            try {
                shows =
                    (await this.pluginInvoker.invoke(plugin.record.id, 'podcast.listShows', async () => plugin.instance.listShows(), {
                        timeoutMs: REFRESH_LIST_SHOWS_TIMEOUT_MS,
                    })) ?? [];
            } catch (error) {
                this.logger.warn(
                    `podcasts: a plugin could not say what it carries, so none of its shows were refreshed (${plugin.record.id}: ${errorText(error)})`,
                );
                continue;
            }

            for (const show of shows) {
                if (signal?.aborted) break;
                if (!show?.id) continue;

                summary.shows += 1;
                const showId = qualifyShowId(plugin.record.id, show.id);

                let episodes: PodcastEpisode[];
                try {
                    episodes =
                        (await this.pluginInvoker.invoke(
                            plugin.record.id,
                            'podcast.listEpisodes',
                            async () => plugin.instance.listEpisodes({ showId: show.id, limit: REFRESH_EPISODES_PER_SHOW }),
                            { timeoutMs: LIST_EPISODES_TIMEOUT_MS },
                        )) ?? [];
                } catch (error) {
                    summary.failed.push(showId);
                    this.logger.info(`podcasts: a show's episodes could not be listed (${showId}: ${errorText(error)})`);
                    continue;
                }

                const listings = episodes.flatMap(episode => {
                    const listing = toListing(showId, show, episode);
                    return listing === undefined ? [] : [listing];
                });

                summary.listed += listings.length;
                summary.added += await this.episodes.record(listings);
            }
        }

        return summary;
    }

    /** Every podcast plugin that can answer right now, in a stable order. */
    private plugins(): PodcastPlugin[] {
        return pluginsWith(this.pluginRegistry.list(), asPodcastPlugin).sort(byPluginId);
    }
}

/** A plugin's show as the console reads it. */
function toStationShow(pluginId: string, show: PodcastShow): StationShow {
    return {
        id: qualifyShowId(pluginId, show.id),
        pluginId,
        title: show.title,
        ...(show.author === undefined ? {} : { author: show.author }),
        ...(show.description === undefined ? {} : { description: show.description }),
        ...(show.artworkUrl === undefined ? {} : { artworkUrl: show.artworkUrl }),
        ...(show.homeUrl === undefined ? {} : { homeUrl: show.homeUrl }),
        ...(show.feedUrl === undefined ? {} : { feedUrl: show.feedUrl }),
        ...(show.language === undefined ? {} : { language: show.language }),
        ...(show.categories === undefined ? {} : { categories: show.categories }),
        ...(show.explicit === undefined ? {} : { explicit: show.explicit }),
    };
}

/** A plugin's directory result as the console reads it. */
function toDirectoryEntry(pluginId: string, entry: PodcastDirectoryEntry): StationDirectoryEntry {
    return {
        id: entry.id,
        pluginId,
        title: entry.title,
        feedUrl: entry.feedUrl,
        ...(entry.author === undefined ? {} : { author: entry.author }),
        ...(entry.description === undefined ? {} : { description: entry.description }),
        ...(entry.artworkUrl === undefined ? {} : { artworkUrl: entry.artworkUrl }),
        ...(entry.homeUrl === undefined ? {} : { homeUrl: entry.homeUrl }),
        ...(entry.categories === undefined ? {} : { categories: entry.categories }),
        ...(entry.explicit === undefined ? {} : { explicit: entry.explicit }),
    };
}

/**
 * A plugin's episode as a row the station can keep, or nothing when it is not one.
 *
 * Checked rather than trusted, because this is the boundary: an episode with no id could never be
 * told from the next one, and one whose audio is not at an http(s) address is one nothing here could
 * fetch. Both are the plugin breaking its contract, and both cost that episode alone. A date that will
 * not parse is dropped rather than the episode, since undated is a state the station already handles.
 */
function toListing(showId: string, show: PodcastShow, episode: PodcastEpisode): PodcastEpisodeListing | undefined {
    if (!episode?.id || !episode.title || !isWebAddress(episode.audio?.url)) return undefined;

    const publishedAt = episode.publishedAt === undefined ? undefined : Date.parse(episode.publishedAt);

    return {
        showId,
        episodeId: episode.id,
        showTitle: episode.showTitle || show.title,
        title: episode.title,
        audioUrl: episode.audio.url,
        ...(episode.summary === undefined ? {} : { summary: episode.summary }),
        ...(episode.url === undefined ? {} : { url: episode.url }),
        ...(publishedAt === undefined || Number.isNaN(publishedAt) ? {} : { publishedAt }),
        ...(episode.durationMs === undefined ? {} : { durationMs: episode.durationMs }),
        ...(episode.audio.mimeType === undefined ? {} : { audioMime: episode.audio.mimeType }),
        ...(episode.audio.lengthBytes === undefined ? {} : { audioBytes: episode.audio.lengthBytes }),
        ...(episode.artworkUrl === undefined ? {} : { artworkUrl: episode.artworkUrl }),
        ...(episode.explicit === undefined ? {} : { explicit: episode.explicit }),
    };
}

/** A row as the console reads it. Instants as ISO-8601, the contract's rule. */
function toStationEpisode(row: PodcastEpisodeRecord): StationEpisode {
    const iso = (millis: number): string => new Date(millis).toISOString();

    return {
        id: row.id,
        showId: row.showId,
        episodeId: row.episodeId,
        showTitle: row.showTitle,
        title: row.title,
        seenAt: iso(row.seenAt),
        fetched: row.segmentId !== undefined,
        ...(row.summary === undefined ? {} : { summary: row.summary }),
        ...(row.url === undefined ? {} : { url: row.url }),
        ...(row.publishedAt === undefined ? {} : { publishedAt: iso(row.publishedAt) }),
        ...(row.durationMs === undefined ? {} : { durationMs: row.durationMs }),
        ...(row.artworkUrl === undefined ? {} : { artworkUrl: row.artworkUrl }),
        ...(row.explicit === undefined ? {} : { explicit: row.explicit }),
        ...(row.fetchRequestedAt === undefined ? {} : { fetchRequestedAt: iso(row.fetchRequestedAt) }),
        ...(row.fetchError === undefined ? {} : { fetchError: row.fetchError }),
        ...(row.scheduledFor === undefined ? {} : { scheduledFor: iso(row.scheduledFor) }),
        ...(row.airedAt === undefined ? {} : { airedAt: iso(row.airedAt) }),
    };
}

/** An http(s) address, which is the only kind anything here could fetch. */
function isWebAddress(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    try {
        const { protocol } = new URL(value);
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
}
