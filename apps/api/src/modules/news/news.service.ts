import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { NewsItem } from '@deadair/plugin-sdk';
import { asNewsPlugin, type NewsPlugin } from '#modules/plugins/plugin.capabilities.js';
import { byPluginId, pluginsWith } from '#modules/plugins/plugin.selection.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { errorText } from '#modules/shared/error.text.js';
import { qualifyFeedId, splitFeedId } from './feed.ids.js';
import type { NewsPage, NewsQuery, StationFeed, StationFeedList } from './types/news.types.js';

/**
 * What happened outside the station, as the station can see it: every feed
 * every installed plugin offers, under ids that say which plugin offered them.
 *
 * ## A menu, not a merge
 *
 * Enrichment fans out and reconciles, because several sources describing one
 * record is more knowledge about that record. News does not work that way: two
 * services' accounts of a day are two accounts, and combining them would
 * produce a bulletin nobody stands behind. So this enumerates and never merges,
 * there is no `priority` on the capability, and choosing between newsrooms is
 * the operator installing what they trust.
 *
 * ## It reads and nothing else
 *
 * Nothing here writes, schedules or airs. A news item is a FACT, and the only
 * thing that can be done with one is say it — which is a break writer's
 * decision, made by a station that is on air, in a voice somebody chose. Keeping
 * that boundary is what stops a feed from being able to interrupt a record.
 *
 * ## A plugin that cannot answer contributes nothing
 *
 * Every call into a plugin is caught and logged rather than thrown, the same
 * rule {@link ChartsService} and `ToolRegistry` apply: a publisher being down
 * should cost its own stories and not the operator's whole menu.
 */
@Injectable()
export class NewsService {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly logger: Logger,
    ) {}

    /** Whether anything can answer at all, for a caller deciding whether to offer the feature. */
    hasNews(): boolean {
        return this.plugins().length > 0;
    }

    /**
     * {@link listFeeds} as the console reads it.
     *
     * Thin, and separate rather than folded in, for `ChartsService.readCharts`'s
     * reason: a route wants the contract's wrapper object and the tool wants the
     * list, and shaping one for the other is how a wrapper ends up in a model's
     * context.
     */
    async readFeeds(): Promise<StationFeedList> {
        return { feeds: await this.listFeeds() };
    }

    /**
     * {@link fetchItems} as the console reads it.
     *
     * News nothing could read is an empty page and a 200, not a 404. The plugin
     * may be reloading, its publishers may be down, and neither of those is the
     * operator having asked for something that does not exist.
     */
    async readNews(query: NewsQuery): Promise<NewsPage> {
        const stories = await this.fetchItems({
            ...(query.feedId === undefined ? {} : { feedId: query.feedId }),
            limit: query.limit ?? MAX_NEWS_ITEMS,
            ...(query.since === undefined ? {} : { since: query.since }),
        });

        return { stories };
    }

    /**
     * Every feed on offer, with its id qualified by the plugin that named it.
     *
     * `StationFeed` is the CONTRACT's type rather than one of this module's own,
     * exactly as `ChartsService` uses `StationChart`: a feed is a thing the
     * console draws a list of, and a second hand-written shape beside the
     * generated one is two places for a field to be added to.
     *
     * Ordered by plugin and then by the order the plugin itself gave, because
     * that order is a decision somebody made — an operator's list is in the
     * order they wrote it — and re-sorting by name would throw it away.
     */
    async listFeeds(): Promise<StationFeed[]> {
        const feeds: StationFeed[] = [];

        for (const plugin of this.plugins()) {
            let offered;
            try {
                offered = await this.pluginInvoker.invoke(plugin.record.id, 'news.listFeeds', async () => plugin.instance.listFeeds());
            } catch (error) {
                this.logger.info(`news: a plugin could not say what it offers (${plugin.record.id}: ${errorText(error)})`);
                continue;
            }

            for (const feed of offered ?? []) {
                if (!feed?.id || !feed.name) continue;
                feeds.push({
                    id: qualifyFeedId(plugin.record.id, feed.id),
                    pluginId: plugin.record.id,
                    name: feed.name,
                    ...(feed.category === undefined ? {} : { category: feed.category }),
                    ...(feed.language === undefined ? {} : { language: feed.language }),
                    ...(feed.description === undefined ? {} : { description: feed.description }),
                });
            }
        }

        return feeds;
    }

    /**
     * What each feed says it IS, keyed by the qualified id its stories carry.
     *
     * The strongest of the three classification signals, and the only one that does not travel with
     * a story: a `NewsItem` is what a publisher published, and the category is what the OPERATOR
     * said about the feed it came out of. So a caller that classifies asks for both and joins them
     * on the feed id, rather than this stamping a station's opinion onto somebody else's entry.
     *
     * A feed nobody has categorised is simply absent, which is the ordinary state.
     */
    async feedCategories(): Promise<Map<string, string>> {
        const categories = new Map<string, string>();
        for (const feed of await this.listFeeds()) {
            if (feed.category !== undefined && feed.category.trim().length > 0) categories.set(feed.id, feed.category.trim());
        }
        return categories;
    }

    /**
     * Published entries, newest first.
     *
     * With a `feedId` this asks the one plugin that minted it. Without one it
     * asks every installed plugin and merges what comes back — which is not the
     * merge this class refuses to do: the stories stay whole and separately
     * attributed, and all that is combined is the ORDER. Two newsrooms in one
     * list is a wire; two newsrooms averaged into one story is a fabrication.
     *
     * `[]` covers every way of having no answer, since they are one outcome to
     * every caller here and the log line is where the difference lives.
     */
    async fetchItems(query: NewsItemQuery): Promise<NewsItem[]> {
        const limit = clampLimit(query.limit);

        if (query.feedId !== undefined) {
            const address = splitFeedId(query.feedId);
            if (!address) {
                this.logger.info(`news: "${query.feedId}" is not a feed id (expected "pluginId:feedId")`);
                return [];
            }

            const plugin = this.plugins().find(candidate => candidate.record.id === address.pluginId);
            if (!plugin) {
                this.logger.info(`news: no active plugin called "${address.pluginId}" can serve a feed`);
                return [];
            }

            return await this.ask(plugin, { feedId: address.feedId, limit, ...(query.since === undefined ? {} : { since: query.since }) });
        }

        const collected: NewsItem[] = [];
        for (const plugin of this.plugins()) {
            // Each plugin is asked for the whole limit rather than a share of it:
            // a station with two plugins where one is quiet should still get a
            // full list, and the merge below is what cuts it back to size.
            collected.push(...(await this.ask(plugin, { limit, ...(query.since === undefined ? {} : { since: query.since }) })));
        }

        return newestFirst(collected).slice(0, limit);
    }

    /**
     * One plugin's answer, qualified and defended.
     *
     * The qualification is the load-bearing part: a plugin's `feedId` is its
     * own, and an item leaving here carries the id the console and the model
     * will ask for next. Getting that wrong produces a story attributed to a
     * feed nobody can fetch, which is worse than no story.
     */
    private async ask(plugin: NewsPlugin, query: { feedId?: string; limit: number; since?: string }): Promise<NewsItem[]> {
        try {
            const items = await this.pluginInvoker.invoke(plugin.record.id, 'news.fetchItems', async () => plugin.instance.fetchItems(query));

            return (items ?? [])
                .filter(item => item?.title?.trim() && item.id?.trim())
                .map(item => ({ ...item, id: qualifyFeedId(plugin.record.id, item.id), feedId: qualifyFeedId(plugin.record.id, item.feedId) }));
        } catch (error) {
            this.logger.info(`news: a feed could not be read (${plugin.record.id}: ${errorText(error)})`);
            return [];
        }
    }

    /** Every plugin that can serve news right now, in a stable order. */
    private plugins(): NewsPlugin[] {
        return pluginsWith(this.pluginRegistry.list(), asNewsPlugin).sort(byPluginId);
    }
}

/** What {@link NewsService.fetchItems} takes: the capability's query with a qualified feed id. */
export interface NewsItemQuery {
    /** A qualified id, as {@link NewsService.listFeeds} answered with. */
    feedId?: string;
    limit: number;
    /** ISO-8601. Only entries published after it. */
    since?: string;
}

/**
 * How many entries the news may be asked for.
 *
 * A ceiling rather than a page size: this number reaches somebody else's server,
 * and a caller that asks for a thousand is asking a third party for a thousand.
 */
export const MAX_NEWS_ITEMS = 50;

const clampLimit = (value: number): number => {
    if (!Number.isFinite(value)) return MAX_NEWS_ITEMS;
    return Math.min(Math.max(Math.floor(value), 1), MAX_NEWS_ITEMS);
};

/** Newest first, with undated entries behind them in the order their plugins gave. */
const newestFirst = (items: NewsItem[]): NewsItem[] => [...items].sort((left, right) => at(right) - at(left));

const at = (item: NewsItem): number => (item.publishedAt === undefined ? 0 : new Date(item.publishedAt).getTime() || 0);
