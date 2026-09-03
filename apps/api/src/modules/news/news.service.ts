import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { NewsItem } from '@deadair/plugin-sdk';
import { asNewsPlugin, type NewsPlugin } from '#modules/plugins/plugin.capabilities.js';
import { byPluginId, pluginsWith } from '#modules/plugins/plugin.selection.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { TopicRepository } from '#modules/topics/topic.repository.js';
import { errorText } from '#modules/shared/error.text.js';
import { NEWS_KIND } from '#modules/director/news.break.writer.js';
import { keptOffAir, newsTopicRules, type ClassifiableStory, type NewsTopicRules } from './news.classify.js';
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
 * ## It does withhold what the station said it will not air
 *
 * The one thing this takes out of a plugin's answer is a story an off-air category claims
 * (`news.classify.ts`). That is not a merge and it is not an opinion about a newsroom: it is the
 * operator having said this material is not news, and it happens HERE so that the bulletin, the
 * model's tool and the console cannot disagree about what the station has. A publisher's shopping
 * desk arriving in a general feed is the ordinary case, and it aired.
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
        /** The station's own categories, read per call for `BulletinSource.categories`'s reason. */
        private readonly topics: TopicRepository,
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

            const answered = await this.ask(plugin, { feedId: address.feedId, limit, ...(query.since === undefined ? {} : { since: query.since }) });
            return await this.airable(answered);
        }

        const collected: NewsItem[] = [];
        for (const plugin of this.plugins()) {
            // Each plugin is asked for the whole limit rather than a share of it:
            // a station with two plugins where one is quiet should still get a
            // full list, and the merge below is what cuts it back to size.
            collected.push(...(await this.ask(plugin, { limit, ...(query.since === undefined ? {} : { since: query.since }) })));
        }

        // Withheld BEFORE the cut, or a page of shopping posts would push real stories past `limit`
        // and then be dropped, leaving a caller that asked for ten with two.
        return newestFirst(await this.airable(collected)).slice(0, limit);
    }

    /**
     * The same stories without the ones an off-air category claims.
     *
     * Asked for the feeds' own categories as well, because that is the strongest of the three
     * signals and the only one that does not travel with a story: a whole feed is kept out by
     * pointing it at an off-air category, which is the cheapest thing an operator can do about a
     * publisher whose deals desk shares its main feed.
     *
     * Nothing is withheld when the categories cannot be read, on `BulletinSource.categories`' rule:
     * a station whose topics table is unreadable reads the news exactly as it did before any of this
     * existed, rather than losing its bulletin to a filter that could not load.
     */
    private async airable(items: NewsItem[]): Promise<NewsItem[]> {
        const rules = await this.offAirRules();
        if (rules.length === 0 || items.length === 0) return items;

        const declared = await this.feedCategories().catch(() => new Map<string, string>());

        const kept: NewsItem[] = [];
        const dropped = new Map<string, number>();

        for (const item of items) {
            const claimed = keptOffAir(withFeedCategory(item, declared), rules);
            if (claimed === undefined) {
                kept.push(item);
                continue;
            }

            dropped.set(claimed.label, (dropped.get(claimed.label) ?? 0) + 1);
        }

        // Named rather than counted, because "why is that story missing" is the question this line
        // exists to answer and the category that claimed it is the whole answer.
        if (dropped.size > 0)
            this.logger.debug('news: kept stories off the air', {
                dropped: [...dropped].map(([label, count]) => `${label}: ${count}`).join(', '),
                kept: kept.length,
            });

        return kept;
    }

    /**
     * The categories that withhold a story, or none when they cannot be read.
     *
     * Read per call rather than held, for the reason `BulletinSource` reads its categories per
     * bulletin: an operator who has just marked a category off air should see the next page without
     * it rather than after a restart.
     */
    private async offAirRules(): Promise<NewsTopicRules[]> {
        try {
            return (await this.topics.list(NEWS_KIND)).map(newsTopicRules).filter(rule => rule.offAir);
        } catch (error) {
            this.logger.info(`news: the categories could not be read, so nothing was kept off the air (${errorText(error)})`);
            return [];
        }
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

/** A story with what its feed says it is attached, which is the one classification signal it does not carry. */
const withFeedCategory = (story: NewsItem, declared: ReadonlyMap<string, string>): ClassifiableStory => {
    const category = declared.get(story.feedId);
    return { ...story, ...(category === undefined ? {} : { feedCategory: category }) };
};

/** Newest first, with undated entries behind them in the order their plugins gave. */
const newestFirst = (items: NewsItem[]): NewsItem[] => [...items].sort((left, right) => at(right) - at(left));

const at = (item: NewsItem): number => (item.publishedAt === undefined ? 0 : new Date(item.publishedAt).getTime() || 0);
