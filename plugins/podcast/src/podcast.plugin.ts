import {
    fetchFeed,
    jsonBody,
    Plugin,
    type FeedEnclosure,
    type FeedItem,
    type ParsedFeed,
    type PluginConnectionResult,
    type PluginHost,
    type PodcastDirectoryEntry,
    type PodcastDirectoryQuery,
    type PodcastEpisode,
    type PodcastEpisodesQuery,
    type PodcastPluginInstance,
    type PodcastShow,
} from '@deadair/plugin-sdk';

import { directorySearchUrl, toDirectoryEntries, type ItunesSearchAnswer } from './podcast.directory.js';
import { parsePodcastRows, type ConfiguredShow } from './podcast.feeds.js';
import { DEFAULT_CACHE_SECONDS, DEFAULT_DIRECTORY, DIRECTORY_TIMEOUT_MS, REQUEST_TIMEOUT_MS } from './podcast.manifest.js';

export { podcastManifest } from './podcast.manifest.js';

/**
 * The podcasts an operator subscribed the station to, as shows and their episodes.
 *
 * Thin on purpose, like `plugins/rss`: everything difficult about a podcast feed — the enclosure,
 * the iTunes duration, the three ways a feed names its artwork — lives in the SDK's `feed.parse.ts`
 * because any plugin reading one needs it. What is left here is the operator's list, a cache, the
 * rule for what counts as an episode, and a directory.
 *
 * ## It never touches the audio
 *
 * An episode's enclosure is handed back as an address and nothing else. The station fetches it
 * itself, once, ahead of the slot the episode airs in; see `capabilities/podcast.ts` for why that
 * is the host's job. So this plugin's allowlist is the feeds and the directory and nothing more, and
 * an enclosure on a CDN nobody named is not something it has to be allowed to reach.
 *
 * ## One show's bad day costs one show
 *
 * `plugins/rss`'s rule, for the same reason: a fan-out over somebody else's servers fails partially
 * and constantly. A feed that could not be read lists no episodes and is logged; the show itself is
 * still listed, because a subscription does not stop existing when its host has a bad minute, and a
 * show vanishing from the console for as long as its feed is down would read as the station having
 * forgotten it.
 */

/** A feed as it was last read, with the moment it was read. */
interface CachedFeed {
    feed: ParsedFeed;
    readAt: number;
}

/**
 * Budget below which another feed is not worth starting.
 *
 * Higher than `plugins/rss`'s, because a podcast feed is a much larger document. Listing shows reads
 * every feed on the list, and a station with thirty subscriptions and a short deadline should list
 * the rest from what it already knows rather than be cut off in the middle of the thirtieth.
 */
const FEED_BUDGET_MS = 3_000;

/**
 * Media types that say `audio/` and are not audio.
 *
 * A playlist is a text file pointing at a stream, and a station that fetched one expecting an episode
 * would store forty bytes of somebody else's `.m3u`.
 */
const PLAYLIST_TYPES = new Set(['audio/x-mpegurl', 'audio/mpegurl', 'audio/x-scpls', 'audio/scpls']);

/**
 * The extensions an attachment with no useful media type is judged by.
 *
 * Only for a type that says nothing (`application/octet-stream`, an empty attribute), which is
 * ordinary on self-hosted feeds. A type that says `video/` is believed over any extension: a video
 * podcast's file is not something this station can put on the air, even where its audio track would
 * be. Whether the station can SERVE a given audio format is the station's question, asked when it
 * fetches; this only asks whether the entry is an episode at all.
 */
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac']);

export class PodcastPlugin extends Plugin implements PodcastPluginInstance {
    private shows: ConfiguredShow[] = [];
    private directory = DEFAULT_DIRECTORY;
    private country = '';
    private cacheSeconds = DEFAULT_CACHE_SECONDS;
    private readonly cache = new Map<string, CachedFeed>();

    protected async onLoad(): Promise<void> {
        const host = this.host;
        const config = await host.config.get();

        this.shows = parsePodcastRows(config.feeds);
        this.directory = config.directory !== false;
        this.country = typeof config.country === 'string' ? config.country.trim() : '';
        this.cacheSeconds = notNegative(config.cacheSeconds) ?? DEFAULT_CACHE_SECONDS;

        host.logger.info('podcasts ready', { shows: this.shows.length, directory: this.directory });
    }

    protected async onUnload(): Promise<void> {
        this.cache.clear();
        this.shows = [];
    }

    /**
     * Every subscription, described as well as what is known about it allows.
     *
     * Held from load rather than re-read per call, which is safe for `plugins/rss`'s reason: a config
     * write reinitializes the plugin, so an edited list arrives as a new instance.
     */
    async listShows(): Promise<PodcastShow[]> {
        const host = this.host;
        const answered: PodcastShow[] = [];

        for (const show of this.shows) {
            // A show is listed whether or not its feed can be read now. What is skipped when the
            // budget runs low is only the READ, so the list stays whole and the tail of it is
            // described from the cache, or by its row alone.
            const feed = host.remainingMs() < FEED_BUDGET_MS ? this.cached(show.url, true) : await this.read(host, show);
            answered.push(toShow(show, feed));
        }

        return answered;
    }

    async listEpisodes(query: PodcastEpisodesQuery): Promise<PodcastEpisode[]> {
        const host = this.host;

        // An id nothing on the list answers to is a stale request rather than a fault: the list is
        // rebuilt whenever the operator edits it.
        const show = this.shows.find(candidate => candidate.id === query.showId);
        if (show === undefined) return [];

        const feed = await this.read(host, show);
        if (feed === undefined) return [];

        const title = showTitle(show, feed);
        const episodes = feed.items.flatMap(item => {
            const episode = toEpisode(item, show, title, feed);
            return episode === undefined ? [] : [episode];
        });

        return newestFirst(sinceOnly(episodes, query.since)).slice(0, Math.max(0, Math.floor(query.limit)));
    }

    /**
     * Shows Apple's directory knows by these words.
     *
     * An empty array for every way this can fail to find something — the switch is off, the words are
     * blank, Apple is down or refusing — because to an operator typing a name they are one outcome,
     * and a directory is a convenience on top of pasting an address rather than the way in.
     */
    async searchShows(query: PodcastDirectoryQuery): Promise<PodcastDirectoryEntry[]> {
        const host = this.host;
        const words = query.query.trim();
        if (!this.directory || words.length === 0 || query.limit <= 0) return [];

        try {
            const response = await host.fetch(directorySearchUrl(words, query.limit, this.country), { timeoutMs: DIRECTORY_TIMEOUT_MS });
            if (!response.ok) {
                await response.body?.cancel().catch(() => {});
                host.logger.warn('podcasts: the directory refused a search', { status: response.status });
                return [];
            }

            return toDirectoryEntries(await jsonBody<ItunesSearchAnswer>(response), query.limit);
        } catch (error) {
            host.logger.warn('podcasts: the directory could not be searched', { error: message(error) });
            return [];
        }
    }

    /**
     * Whether the subscriptions actually answer with podcasts.
     *
     * Reads every one, for `plugins/rss`'s reason: the failure an operator is checking for is a row
     * they typed wrong, and reporting only the first would hide the rest. And a feed that reads but
     * carries no audio is reported as exactly that, because the commonest wrong address is a show's
     * BLOG feed, which parses perfectly and has no episodes in it.
     */
    async testConnection(): Promise<PluginConnectionResult> {
        const host = this.host;
        const configured = this.shows;
        if (configured.length === 0) {
            return { ok: false, message: 'No shows yet. Add a row above with the address of a podcast feed.' };
        }

        const unreadable: string[] = [];
        const silent: string[] = [];
        for (const show of configured) {
            try {
                const feed = await fetchFeed(host, show.url, { timeoutMs: REQUEST_TIMEOUT_MS });
                this.cache.set(show.url, { feed, readAt: Date.now() });
                if (!feed.items.some(item => isEpisodeAudio(item.enclosure))) silent.push(showTitle(show, feed));
            } catch {
                unreadable.push(show.name ?? hostOf(show.url));
            }
        }

        const readable = configured.length - unreadable.length;
        if (readable === 0) return { ok: false, message: `None of the ${configured.length} feeds could be read.` };

        const parts = [`${readable} of ${configured.length} ${configured.length === 1 ? 'feed' : 'feeds'} read.`];
        if (unreadable.length > 0) parts.push(`Nothing came back from: ${unreadable.join(', ')}.`);
        if (silent.length > 0)
            parts.push(`No episodes with audio in: ${silent.join(', ')}. That is usually a blog's feed rather than the podcast's.`);

        // Passing means the station has at least one show it can carry. A list where some rows are wrong
        // still passes and names them, which is the one place a partial answer is a message.
        return { ok: readable > silent.length, message: parts.join(' ') };
    }

    /**
     * One feed, from the cache or from the publisher.
     *
     * A failure answers `undefined` and is NOT cached, `plugins/rss`'s rule: caching it would turn a
     * host's momentary 502 into five minutes of a show with no episodes. What a failure falls back to
     * instead is whatever was read last, however old, since a show's back catalogue does not stop
     * being true because its host is down.
     */
    private async read(host: PluginHost, show: ConfiguredShow): Promise<ParsedFeed | undefined> {
        const fresh = this.cached(show.url, false);
        if (fresh !== undefined) return fresh;

        try {
            const feed = await fetchFeed(host, show.url, { timeoutMs: REQUEST_TIMEOUT_MS });
            this.cache.set(show.url, { feed, readAt: Date.now() });
            return feed;
        } catch (error) {
            // The publisher's own words are not repeated: this ends up in a log an operator reads,
            // and the useful half is which show failed.
            host.logger.warn('podcasts: a feed could not be read', { show: show.id, error: message(error) });
            return this.cached(show.url, true);
        }
    }

    /** What the cache holds for an address: only if still fresh, or whatever it has when `stale` is allowed. */
    private cached(url: string, stale: boolean): ParsedFeed | undefined {
        const held = this.cache.get(url);
        if (held === undefined) return undefined;
        if (stale || Date.now() - held.readAt < this.cacheSeconds * 1_000) return held.feed;
        return undefined;
    }
}

/** A subscription as a show, from its feed when there is one and from its row when there is not. */
function toShow(show: ConfiguredShow, feed: ParsedFeed | undefined): PodcastShow {
    return {
        id: show.id,
        title: showTitle(show, feed),
        feedUrl: show.url,
        ...(feed?.author === undefined ? {} : { author: feed.author }),
        ...(feed?.description === undefined ? {} : { description: feed.description }),
        ...(feed?.imageUrl === undefined ? {} : { artworkUrl: feed.imageUrl }),
        ...(feed?.homeUrl === undefined ? {} : { homeUrl: feed.homeUrl }),
        ...(feed?.language === undefined ? {} : { language: feed.language }),
        ...(feed?.categories === undefined ? {} : { categories: feed.categories }),
        ...(feed?.explicit === undefined ? {} : { explicit: feed.explicit }),
    };
}

/**
 * What to call a show: the operator's name for it, then its own, then where it lives.
 *
 * The operator's first, because it is the one they chose to type, and a presenter reads this aloud.
 */
function showTitle(show: ConfiguredShow, feed: ParsedFeed | undefined): string {
    return show.name ?? feed?.title ?? hostOf(show.url);
}

/**
 * A feed entry as an episode, or nothing when it is not one.
 *
 * Not one when it attaches no audio. Show notes, a blog post cross-posted into the feed, a video: all
 * ordinary in a podcast feed, and none of them anything the station could carry.
 */
function toEpisode(item: FeedItem, show: ConfiguredShow, title: string, feed: ParsedFeed): PodcastEpisode | undefined {
    const enclosure = item.enclosure;
    if (enclosure === undefined || !isEpisodeAudio(enclosure)) return undefined;

    const artworkUrl = item.imageUrl ?? feed.imageUrl;
    const explicit = item.explicit ?? feed.explicit;

    return {
        id: item.id,
        showId: show.id,
        showTitle: title,
        title: item.title,
        audio: {
            url: enclosure.url,
            ...(enclosure.type === undefined ? {} : { mimeType: enclosure.type }),
            ...(enclosure.lengthBytes === undefined ? {} : { lengthBytes: enclosure.lengthBytes }),
        },
        ...(item.summary === undefined ? {} : { summary: item.summary }),
        ...(item.url === undefined ? {} : { url: item.url }),
        ...(item.publishedAt === undefined ? {} : { publishedAt: item.publishedAt }),
        ...(item.durationMs === undefined ? {} : { durationMs: item.durationMs }),
        ...(artworkUrl === undefined ? {} : { artworkUrl }),
        ...(item.season === undefined ? {} : { season: item.season }),
        ...(item.episode === undefined ? {} : { number: item.episode }),
        ...(explicit === undefined ? {} : { explicit }),
    };
}

/**
 * Whether an attachment is an episode's audio.
 *
 * The media type when it says anything, and the address's extension when it does not. See
 * {@link AUDIO_EXTENSIONS} for why a `video/` type is believed over an `.m4a` on the end.
 */
export function isEpisodeAudio(enclosure: FeedEnclosure | undefined): boolean {
    if (enclosure === undefined) return false;

    const type = enclosure.type ?? '';
    if (type.startsWith('audio/')) return !PLAYLIST_TYPES.has(type);
    if (type.length > 0 && type !== 'application/octet-stream' && type !== 'binary/octet-stream') return false;

    return AUDIO_EXTENSIONS.has(extensionOf(enclosure.url));
}

/** The extension on an address's path, lower-cased, or an empty string. Query strings are ordinary here. */
function extensionOf(url: string): string {
    try {
        const path = new URL(url).pathname;
        const dot = path.lastIndexOf('.');
        return dot < 0 || dot < path.lastIndexOf('/') ? '' : path.slice(dot + 1).toLowerCase();
    } catch {
        return '';
    }
}

/**
 * Episodes published after `since`, keeping the undated ones.
 *
 * `plugins/rss`'s `sinceOnly` exactly: an undated entry is unjudgeable rather than old, and this
 * filter runs on a list the caller cannot see.
 */
function sinceOnly(episodes: PodcastEpisode[], since: string | undefined): PodcastEpisode[] {
    if (since === undefined) return episodes;

    const after = new Date(since).getTime();
    if (Number.isNaN(after)) return episodes;

    return episodes.filter(episode => episode.publishedAt === undefined || new Date(episode.publishedAt).getTime() > after);
}

/**
 * Newest first, with the undated ones behind them in the order the feed gave.
 *
 * Sorted rather than trusted, because "newest first" is what the capability promises and a feed's
 * own order is not: plenty of hosts list oldest first, and a serial published in order often does.
 */
function newestFirst(episodes: PodcastEpisode[]): PodcastEpisode[] {
    return [...episodes].sort((left, right) => at(right) - at(left));
}

const at = (episode: PodcastEpisode): number => (episode.publishedAt === undefined ? 0 : new Date(episode.publishedAt).getTime());

const notNegative = (value: unknown): number | undefined => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
};

/** An error as one short line. Never the upstream's own body. */
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The host a feed lives on, for a show nobody named and whose feed has never been read. */
function hostOf(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return 'podcast';
    }
}
