import {
    fetchArticle,
    fetchFeed,
    Plugin,
    type FeedItem,
    type NewsFeedDescriptor,
    type NewsItem,
    type NewsPluginInstance,
    type NewsQuery,
    type PluginConnectionResult,
} from '@deadair/plugin-sdk';

import { parseFeedRows, type ConfiguredFeed } from './rss.feeds.js';
import { ARTICLE_TIMEOUT_MS, DEFAULT_CACHE_SECONDS, DEFAULT_FETCH_ARTICLES, DEFAULT_MAX_ITEMS, REQUEST_TIMEOUT_MS } from './rss.manifest.js';

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
 *
 * ## A feed is a list of titles, so the stories are fetched separately
 *
 * Measured against the station's own configured feed: every entry's
 * `description` was one sentence restating its title and its `content:encoded`
 * was that same sentence wrapped in a `<p>`. A bulletin built from that reads
 * out a list of headlines, which is what it did. So an item's own link is
 * followed and the page's paragraphs become {@link NewsItem.content}, still the
 * publisher's words in the publisher's order — the plugin fetches and the host
 * thinks.
 *
 * Three bounds, because this is the expensive half. Only items actually being
 * RETURNED are read, so a `maxItems` of 25 never costs 25 pages; no more than
 * {@link MAX_STORIES} per call; and the loop stops on
 * `host.remainingMs`, so a bulletin's long budget reads more of them than a DJ's
 * mid-break tool call does. A page that fails costs its own item and nothing
 * else, exactly as a feed does — the entry's own words are the fallback, and
 * they are a real answer.
 */

/** A feed as it was last read, with the moment it was read. */
interface CachedFeed {
    items: NewsItem[];
    readAt: number;
}

/**
 * An article page as it was last read, with the moment it was read.
 *
 * `text` is optional and a miss is CACHED, which the feed cache deliberately
 * does not do. The difference is what a miss means: a feed that 502'd will
 * probably answer next minute, whereas a page that carried no prose is an audio
 * piece or a photo gallery and will carry none the next twenty times either. Not
 * remembering that would have every bulletin in the window pay for the same
 * empty page.
 */
interface CachedArticle {
    text?: string;
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

/**
 * Budget below which another article is not worth starting.
 *
 * Higher than {@link FEED_BUDGET_MS} because an article page is an order of
 * magnitude bigger than a feed and is served by the publisher's own front end
 * rather than by the CDN in front of a static file.
 */
const ARTICLE_BUDGET_MS = 2_500;

/**
 * Most stories one call will carry.
 *
 * A bulletin asks for twice what it will read (the caller drops anything with no
 * usable headline), so this is deliberately BELOW an ordinary request's limit:
 * the stories a bulletin actually reads are the first few, and paying for the
 * spares would double the cost of the over-fetch that exists to protect the
 * headline count.
 *
 * A cap on STORIES rather than on requests, which it used to be. The rename is
 * the point rather than tidying: a cap on requests is satisfied by fetching,
 * never by having already fetched, so it could not converge. See
 * {@link RssPlugin.withStories}.
 */
const MAX_STORIES = 4;

export class RssPlugin extends Plugin implements NewsPluginInstance {
    private feeds: ConfiguredFeed[] = [];
    private maxItems = DEFAULT_MAX_ITEMS;
    private cacheSeconds = DEFAULT_CACHE_SECONDS;
    private fetchArticles = DEFAULT_FETCH_ARTICLES;
    private readonly cache = new Map<string, CachedFeed>();
    /**
     * Article text by URL, on the same clock as the feed cache.
     *
     * Its own map rather than a field on the cached item, because an article and
     * the feed that named it expire independently: a feed refetched a minute
     * later hands back the same entries, and re-reading a page whose text has
     * not changed would be the whole cost of this feature paid again for
     * nothing.
     */
    private readonly articles = new Map<string, CachedArticle>();

    protected async onLoad(): Promise<void> {
        const config = await this.host.config.get();

        this.feeds = parseFeedRows(config.feeds);
        this.maxItems = positive(config.maxItems) ?? DEFAULT_MAX_ITEMS;
        this.cacheSeconds = notNegative(config.cacheSeconds) ?? DEFAULT_CACHE_SECONDS;
        this.fetchArticles = config.fetchArticles !== false;

        this.host.logger.info('rss news ready', { feeds: this.feeds.length, articles: this.fetchArticles });
    }

    protected async onUnload(): Promise<void> {
        this.cache.clear();
        this.articles.clear();
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

        const answering = newestFirst(sinceOnly(collected, query.since)).slice(0, Math.max(0, query.limit));
        return this.withStories(answering);
    }

    /**
     * The same items, with the story behind each headline where one could be
     * read.
     *
     * Runs on what is being ANSWERED rather than on everything parsed, which is
     * the bound that matters: a feed read 25 entries deep would otherwise cost
     * 25 page loads to answer a request for three.
     *
     * Every failure is the same outcome — no `content` on that item — because
     * they are the same outcome to the caller: a refused host, a page with
     * nothing on it, a PDF, and a budget that ran out all leave the entry's own
     * words as the answer, which is a real answer rather than a hole.
     *
     * {@link MAX_STORIES} counts a story this already HAS, not only one
     * it paid for, and that distinction is the whole of why a warm cache is
     * worth having. Counting requests alone reads as the cheaper rule and is
     * not: a cached page returned without consuming a slot, so the next call
     * carried the top four for free and then went and fetched items five to
     * eight, the call after that nine to twelve, and every call for as long as
     * uncached items remained on the list paid the full four page loads. The cap
     * walked down the list instead of being satisfied by it. Measured on the
     * console's own page, three consecutive loads inside one `cacheSeconds`
     * window cost 3200ms, 3065ms and 3053ms — flat, because the cache was never
     * allowed to answer.
     *
     * So a slot is spent when the item ends up with a story or when a request
     * was paid for trying. What still costs nothing is the case that rule was
     * written for: an item with no link, and a page already known to carry no
     * prose. Neither of those can ever carry a story, so letting either hold a
     * slot would starve the items behind it — which, the cache remembering
     * misses, would otherwise be permanent.
     */
    private async withStories(items: NewsItem[]): Promise<NewsItem[]> {
        if (!this.fetchArticles) return items;

        let carried = 0;
        const answered: NewsItem[] = [];

        for (const item of items) {
            const text = await this.storyFor(item, carried);
            if (text !== undefined) answered.push({ ...item, content: text.content });
            else answered.push(item);

            if (text !== undefined && (text.content !== undefined || text.fetched)) carried += 1;
        }

        return answered;
    }

    /**
     * One item's story: from the cache, from the publisher, or not at all.
     *
     * Answers whether it PAID for the page as well as what it found, because
     * those are the two separate ways a slot gets spent and the caller is the
     * one holding the count. See {@link RssPlugin.withStories} for which
     * combinations spend one.
     */
    private async storyFor(item: NewsItem, carried: number): Promise<{ content?: string; fetched: boolean } | undefined> {
        const url = item.url;
        if (url === undefined) return undefined;

        const cached = this.articles.get(url);
        if (cached !== undefined && Date.now() - cached.readAt < this.cacheSeconds * 1_000) {
            return { ...(cached.text === undefined ? {} : { content: cached.text }), fetched: false };
        }

        // Both checks before starting one, for the reason the feed loop's is:
        // being cut off mid-page costs the request and leaves nothing to show.
        if (carried >= MAX_STORIES) return undefined;
        if (this.host.remainingMs() < ARTICLE_BUDGET_MS) {
            this.host.logger.debug('rss: stopped short of the stories, out of budget', { read: carried });
            return undefined;
        }

        try {
            const text = await fetchArticle(this.host, url, { timeoutMs: ARTICLE_TIMEOUT_MS });
            this.articles.set(url, { ...(text === undefined ? {} : { text }), readAt: Date.now() });
            return { ...(text === undefined ? {} : { content: text }), fetched: true };
        } catch (error) {
            // Not cached: unlike a page that simply had no prose on it, this is
            // the publisher having a bad minute and the next bulletin should try
            // again. The publisher's own words are not repeated; see
            // {@link RssPlugin.read}.
            this.host.logger.debug('rss: a story could not be read', { feed: item.feedId, error: message(error) });
            return { fetched: true };
        }
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
        if (configured.length === 0) return { ok: false, message: 'No feeds yet. Add a row above with the address of one.' };

        const failed: string[] = [];
        let sampleUrl: string | undefined;
        for (const feed of configured) {
            try {
                const parsed = await fetchFeed(this.host, feed.url, { timeoutMs: REQUEST_TIMEOUT_MS });
                // A 200 is not the question. A publisher that moved leaves an
                // HTML page at the old address, which parses to no items at all.
                if (parsed.items.length === 0) failed.push(feed.descriptor.id);
                else sampleUrl ??= parsed.items.find(entry => entry.url !== undefined)?.url;
            } catch {
                failed.push(feed.descriptor.id);
            }
        }

        if (failed.length === configured.length) return { ok: false, message: `None of the ${configured.length} feeds could be read.` };

        const stories = await this.testStories(sampleUrl);
        if (failed.length > 0)
            return {
                ok: true,
                message:
                    `${configured.length - failed.length} of ${configured.length} feeds read. ` +
                    `Nothing came back from: ${failed.join(', ')}.${stories}`,
            };

        return { ok: true, message: `${configured.length} ${configured.length === 1 ? 'feed' : 'feeds'} read.${stories}` };
    }

    /**
     * What a test can say about the stories, having read one.
     *
     * Here because it is the question an operator cannot otherwise answer: the
     * pages a feed links to are on a different host from the feed, so this is
     * either working or being refused per request in a log nobody is reading.
     * One sample rather than a survey, and it names the host, because the fix
     * when it is refused is a station setting that takes a plugin id and the
     * operator needs to know which plugin is asking for what.
     */
    private async testStories(sampleUrl: string | undefined): Promise<string> {
        if (!this.fetchArticles) return ' Stories are off, so the station reads headlines only.';
        if (sampleUrl === undefined) return ' No entry linked to a story, so the station reads headlines only.';

        const host = hostOf(sampleUrl);
        try {
            const text = await fetchArticle(this.host, sampleUrl, { timeoutMs: ARTICLE_TIMEOUT_MS });
            if (text === undefined) return ` Read ${host}, but that story carried no article text; the station falls back to the headline.`;

            return ` Stories read from ${host}.`;
        } catch (error) {
            return ` Stories could not be read from ${host} (${message(error)}). Allow this plugin the open web, under what it has asked for on this page.`;
        }
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

/** The hostname of an address, for a sentence an operator reads. */
const hostOf = (url: string): string => {
    try {
        return new URL(url).hostname;
    } catch {
        return 'that publisher';
    }
};
