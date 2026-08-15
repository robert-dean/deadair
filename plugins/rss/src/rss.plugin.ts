import {
    fetchFeed,
    Plugin,
    type FeedItem,
    type NewsFeedDescriptor,
    type NewsItem,
    type NewsPluginInstance,
    type NewsQuery,
    type PluginConnectionResult,
} from '@deadair/plugin-sdk';

import { parseFeedLines, type ConfiguredFeed } from './rss.feeds.js';
import { DEFAULT_CACHE_SECONDS, DEFAULT_MAX_ITEMS, REQUEST_TIMEOUT_MS } from './rss.manifest.js';

export { rssManifest } from './rss.manifest.js';

/**
 * Whatever the operator pointed the station at, as news.
 *
 * Thin on purpose. Everything that is actually difficult about reading a feed
 * lives in the SDK (`feed.parse.ts`) because every plugin that reads one needs
 * it, and everything about reaching a publisher lives in `host.fetch`. What is
 * left here is the operator's list, a cache measured in seconds, and the
 * mapping from a parsed entry to a {@link NewsItem}.
 *
 * ## One feed's bad day costs one feed
 *
 * A fan-out over somebody else's servers fails partially and constantly: one
 * publisher 500s, one is slow, one has moved. So a feed that could not be read
 * contributes nothing and is logged, and the answer is what the others had.
 * The alternative — one failure rejecting the call — would make the station's
 * news as reliable as the least reliable line on the list.
 *
 * ## The cache is a floor on asking, never a filter on answering
 *
 * A caller polling faster than {@link cacheSeconds} sees the same entries
 * again, which is harmless because every {@link NewsItem.id} is stable. A cache
 * that instead answered "nothing new since you last asked" would be inventing
 * that claim out of its own refresh interval, and anything watching for
 * breaking news would miss exactly the stories that arrived in the window.
 */

/** A feed as it was last read, with the moment it was read. */
interface CachedFeed {
    items: NewsItem[];
    readAt: number;
}

/**
 * Budget below which another feed is not worth starting.
 *
 * The point of {@link PluginHost.remainingMs} rather than a fixed count: a
 * background refill runs on a far longer deadline than a break the model is
 * waiting on, and the right number of feeds to read differs between them. Ten
 * headlines from three feeds beats being cut off halfway through the fourth
 * with nothing to show for any of them.
 */
const FEED_BUDGET_MS = 1_500;

export class RssPlugin extends Plugin implements NewsPluginInstance {
    private feeds: ConfiguredFeed[] = [];
    private maxItems = DEFAULT_MAX_ITEMS;
    private cacheSeconds = DEFAULT_CACHE_SECONDS;
    private readonly cache = new Map<string, CachedFeed>();

    protected async onLoad(): Promise<void> {
        const config = await this.host.config.get();

        this.feeds = parseFeedLines(typeof config.feeds === 'string' ? config.feeds : undefined);
        this.maxItems = positive(config.maxItems) ?? DEFAULT_MAX_ITEMS;
        this.cacheSeconds = notNegative(config.cacheSeconds) ?? DEFAULT_CACHE_SECONDS;

        this.host.logger.info('rss news ready', { feeds: this.feeds.length });
    }

    protected async onUnload(): Promise<void> {
        this.cache.clear();
        this.feeds = [];
    }

    /**
     * What the operator has configured.
     *
     * Held from load rather than re-read per call, which is safe for one
     * specific reason and not by luck: a config write goes through
     * `PluginLifecycleManager.reinitPlugin`, so an edited list arrives as a new
     * instance rather than as a stale field. What the SDK warns against is the
     * HOST caching this across that reinit, which is why the capability is
     * asked every time and this is not.
     */
    async listFeeds(): Promise<NewsFeedDescriptor[]> {
        return this.feeds.map(feed => feed.descriptor);
    }

    async fetchItems(query: NewsQuery): Promise<NewsItem[]> {
        // An id nothing on the list answers to is a stale request rather than a
        // fault: the menu is rebuilt whenever the operator edits the setting.
        const wanted = query.feedId === undefined ? this.feeds : this.feeds.filter(feed => feed.descriptor.id === query.feedId);

        const collected: NewsItem[] = [];
        for (const feed of wanted) {
            // A partial answer beats being cut off mid-feed, so the check is
            // before starting one rather than after.
            if (collected.length > 0 && this.host.remainingMs() < FEED_BUDGET_MS) {
                this.host.logger.debug('rss: stopped short of the whole list, out of budget', { read: collected.length });
                break;
            }

            collected.push(...(await this.read(feed)));
        }

        return newestFirst(sinceOnly(collected, query.since)).slice(0, Math.max(0, query.limit));
    }

    /**
     * One feed, from the cache or from the publisher.
     *
     * The failure path is the interesting one: it answers with nothing rather
     * than throwing, and it does not cache that nothing. Caching a failure would
     * turn a publisher's momentary 502 into a minute of a station that has no
     * news, which is the opposite of what a cache is for here.
     */
    private async read(feed: ConfiguredFeed): Promise<NewsItem[]> {
        const cached = this.cache.get(feed.url);
        if (cached !== undefined && Date.now() - cached.readAt < this.cacheSeconds * 1_000) return cached.items;

        try {
            const parsed = await fetchFeed(this.host, feed.url, { timeoutMs: REQUEST_TIMEOUT_MS });
            const items = parsed.items.slice(0, this.maxItems).map(entry => toNewsItem(entry, feed.descriptor));

            this.cache.set(feed.url, { items, readAt: Date.now() });
            return items;
        } catch (error) {
            // The publisher's own words are not repeated: this line ends up in a
            // log an operator reads, and the useful half is which feed failed.
            this.host.logger.warn('rss: a feed could not be read', { feed: feed.descriptor.id, error: message(error) });
            return [];
        }
    }

    /**
     * Whether the addresses actually answer with feeds.
     *
     * Reads every one, because the failure an operator is checking for is a
     * line they typed wrong and reporting only the first would hide the rest. A
     * list where some work and some do not is reported as exactly that: this is
     * the one place a partial answer is a message rather than a silence.
     */
    async testConnection(): Promise<PluginConnectionResult> {
        const configured = this.feeds;
        if (configured.length === 0) return { ok: false, message: 'No feeds yet. Paste one address per line above.' };

        const failed: string[] = [];
        for (const feed of configured) {
            try {
                const parsed = await fetchFeed(this.host, feed.url, { timeoutMs: REQUEST_TIMEOUT_MS });
                // A 200 is not the question. A publisher that moved leaves an
                // HTML page at the old address, which parses to no items at all.
                if (parsed.items.length === 0) failed.push(feed.descriptor.id);
            } catch {
                failed.push(feed.descriptor.id);
            }
        }

        if (failed.length === configured.length) return { ok: false, message: `None of the ${configured.length} feeds could be read.` };
        if (failed.length > 0)
            return {
                ok: true,
                message: `${configured.length - failed.length} of ${configured.length} feeds read. Nothing came back from: ${failed.join(', ')}.`,
            };

        return { ok: true, message: `${configured.length} ${configured.length === 1 ? 'feed' : 'feeds'} read.` };
    }
}

/** A parsed entry, as the capability's item. The feed it came from is the plugin's to add. */
function toNewsItem(entry: FeedItem, feed: NewsFeedDescriptor): NewsItem {
    return {
        // Qualified by the feed, because two feeds at one publisher legitimately
        // carry the same guid for the same story and a caller de-duplicating on
        // id alone would drop the second feed's copy without knowing it had.
        id: `${feed.id}:${entry.id}`,
        feedId: feed.id,
        feedName: feed.name,
        title: entry.title,
        ...(entry.summary === undefined ? {} : { summary: entry.summary }),
        ...(entry.url === undefined ? {} : { url: entry.url }),
        ...(entry.publishedAt === undefined ? {} : { publishedAt: entry.publishedAt }),
        ...(entry.categories === undefined ? {} : { categories: entry.categories }),
    };
}

/**
 * Entries published after `since`.
 *
 * An entry with NO date is kept, deliberately. `since` asks what is new and an
 * undated entry is unjudgeable rather than old, so dropping it would silently
 * lose every story from a publisher that dates nothing — and this filter runs
 * on a list the caller cannot see, so there would be no sign of it.
 */
function sinceOnly(items: NewsItem[], since: string | undefined): NewsItem[] {
    if (since === undefined) return items;

    const after = new Date(since).getTime();
    if (Number.isNaN(after)) return items;

    return items.filter(item => item.publishedAt === undefined || new Date(item.publishedAt).getTime() > after);
}

/** Newest first across every feed, with the undated ones behind them in the order they came. */
function newestFirst(items: NewsItem[]): NewsItem[] {
    return [...items].sort((left, right) => at(right) - at(left));
}

const at = (item: NewsItem): number => (item.publishedAt === undefined ? 0 : new Date(item.publishedAt).getTime());

const positive = (value: unknown): number | undefined => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
};

const notNegative = (value: unknown): number | undefined => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
};

/** An error as one short line. Never the upstream's own body; see {@link RssPlugin.read}. */
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
