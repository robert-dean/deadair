import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { categoriesOf, newsTopicRules, type ClassifiableStory, type NewsTopicRules } from '#modules/news/news.classify.js';
import type { NewsItem } from '@deadair/plugin-sdk';
import { NewsService } from '#modules/news/news.service.js';
import { TopicRepository } from '#modules/topics/topic.repository.js';
import { NEWS_KIND } from '#modules/director/news.break.writer.js';
import type { StationTool, ToolSource } from './llm.tools.js';

/**
 * "What happened?", as something a model can ask.
 *
 * ## The one tool that is not about records
 *
 * Every other source here answers a question about music: what the station has,
 * what it can get, what is popular, who sounds alike, what the operator likes.
 * This one answers about the world, and what comes back cannot be played — so
 * nothing downstream of it goes near the pick path, and the only thing a DJ can
 * do with an answer is talk.
 *
 * That is also what makes it worth having. A break is usually short of FACTS,
 * and the true things a station can say between two records are otherwise
 * limited to the two records.
 *
 * ## Why this one IS backed by a plugin
 *
 * [tool-plugins](https://github.com/robert-dean/deadair/discussions/44)'s rule: a tool is a plugin when the thing it talks
 * to is somebody else's service, and a host-side source when it talks to
 * deadair. Every feed here belongs to a publisher, so the egress, the rate
 * bucket and the shape of the document live behind `host.fetch` in a plugin, and
 * this file is only the adapter that lets a model reach {@link NewsService}.
 *
 * ## The station's own categories are offered, and are not a filter it applies for free
 *
 * A DJ asking "what is happening in technology" is asking a real question, so the categories the
 * operator named are declared as a parameter and the answer is cut to one when it is given. They are
 * the STATION's words rather than the publishers' labels — the same vocabulary a band on the format
 * clock points at — which is what stops a model inventing a category nobody has defined and getting
 * an empty list back with no way to tell that from the world being quiet.
 *
 * A category with nothing in it answers with an empty list and SAYS SO, rather than quietly
 * widening back out: the bulletin's own answer to the same state is to decline the slot, and a tool
 * that silently substituted general news would teach the model that its filter works when it does
 * not.
 *
 * ## Nothing here airs
 *
 * A model reading the news is a DJ reading the news. Whether any of it is spoken
 * is the break writer's decision, made on a station that is on air; this file
 * hands over sentences and has no way to put one on the mount.
 */

/**
 * How many stories come back, whatever was asked for.
 *
 * Smaller than the search tools' twenty-five, because these are sentences rather
 * than one-line records: ten headlines with their summaries is already most of a
 * front page, and a model given forty spends its context on a wire feed it was
 * asked to mention once.
 */
const MAX_RESULTS = 10;

/** One feed on the menu, as the model reads it. Thin: a name and enough to choose between them. */
interface FeedOption {
    id: string;
    name: string;
    category?: string;
}

@Injectable()
export class NewsTool implements ToolSource {
    constructor(
        private readonly news: NewsService,
        private readonly topics: TopicRepository,
        private readonly logger: Logger,
    ) {}

    async tools(): Promise<StationTool[]> {
        // Nothing to offer when no news plugin is installed, which is the
        // default. A declaration whose every call answers "there is no news"
        // spends context teaching the model about a tool that cannot help it —
        // the rule `ChartsTool` follows too.
        if (!this.news.hasNews()) return [];

        // The station's own vocabulary, read once per conversation. A station that has named none
        // gets no `topic` parameter at all rather than one with an empty list behind it, which is
        // the same rule as the tool itself: do not teach a model about a knob that cannot turn.
        const categories = await this.categories();

        return [
            {
                // A headline is a statement about the present. `BulletinSource` fetches the same
                // stories against `segments.airs_at` and is therefore `fetched-for-air`; this fetches
                // against the moment the model asked, and nothing anywhere records how long the
                // answer stays worth saying.
                freshness: 'perishable',
                declaration: {
                    name: 'read_news',
                    // Written for the model, and it says two things deliberately:
                    // that calling it bare is the normal way (a DJ wants the
                    // headlines, not a feed), and that what comes back is true
                    // and may be said out loud, which is the whole point of it.
                    description:
                        'Read the headlines from the news feeds this station follows. Call it with no arguments for the latest across all of them, or name a feed from an earlier call to read one. These are real published stories: you can say them on air, and you should not invent details they do not carry.',
                    parameters: {
                        type: 'object',
                        properties: {
                            feedId: {
                                type: 'string',
                                description: 'Which feed, exactly as an earlier answer listed it. Leave it out for everything the station follows.',
                            },
                            ...(categories.length === 0
                                ? {}
                                : {
                                      topic: {
                                          type: 'string',
                                          enum: categories.map(rule => rule.key),
                                          description: `Only stories in one of the station's own categories: ${categories
                                              .map(rule => `${rule.key} (${rule.label})`)
                                              .join(', ')}. Leave it out for everything.`,
                                      },
                                  }),
                            limit: { type: 'number', description: `How many stories, at most ${MAX_RESULTS}.` },
                            since: {
                                type: 'string',
                                description:
                                    'Only stories published after this time, as an ISO-8601 timestamp. Leave it out for the latest whatever their age.',
                            },
                        },
                        required: [],
                        additionalProperties: false,
                    },
                },
                run: async args => await this.read(args, categories),
            },
        ];
    }

    /**
     * The headlines, and the feeds they came from.
     *
     * The feed list rides along with every answer rather than being a second
     * tool call: there are usually two or three of them, they cost a line each,
     * and a model that wants one feed can then name it without having asked what
     * exists. That is the opposite of `browse_charts`, where the menu is long
     * enough to be worth its own call.
     *
     * News that could not be read comes back as an empty list rather than an
     * error, because `NewsService` has already decided that: a failed publisher,
     * an id that named no plugin and a feed with nothing new are one outcome to a
     * DJ. The count is in the answer so the model can see it found nothing rather
     * than inferring it from silence.
     */
    private async read(
        args: Record<string, unknown>,
        categories: readonly NewsTopicRules[],
    ): Promise<{ feeds: FeedOption[]; stories: unknown[]; note?: string }> {
        const feedId = readText(args.feedId);
        const since = readText(args.since);
        const wanted = readText(args.topic);
        const asked = categories.find(rule => rule.key === wanted);

        const page = await this.news.fetchItems({
            ...(feedId === undefined ? {} : { feedId }),
            // Reaching further down the page when a category was asked for, since most of what comes
            // back will not belong to it. Bounded by `MAX_NEWS_ITEMS` inside `NewsService` either
            // way, because this number reaches somebody else's server.
            limit: asked === undefined ? clampLimit(args.limit) : MAX_RESULTS,
            ...(since === undefined ? {} : { since }),
        });

        // Read before the filter rather than after it, because the menu is also the evidence: what
        // a feed says it IS is the strongest thing a story can be classified on, and it lives on
        // the feed rather than on the entry.
        const offered = await this.news.listFeeds();
        const feeds = offered.map(feed => ({
            id: feed.id,
            name: feed.name,
            ...(feed.category === undefined ? {} : { category: feed.category }),
        }));

        const declared = new Map(offered.flatMap(feed => (feed.category === undefined ? [] : [[feed.id, feed.category] as const])));
        const stories =
            asked === undefined
                ? page
                : page.filter(story => categoriesOf(withFeedCategory(story, declared), [asked]).length > 0).slice(0, clampLimit(args.limit));

        // The line every tool here carries: "how many stories did the model
        // actually have to work with" has to be answerable from the log alone
        // when a break turns out to have mentioned nothing.
        this.logger.debug('llm: read the news', { feedId: feedId ?? 'all', topic: asked?.key ?? 'anything', found: stories.length });

        return {
            feeds,
            // Said rather than left to be inferred from an empty list, and only for the case that
            // is genuinely ambiguous: a model that asked for a category and got nothing cannot
            // otherwise tell "nothing has happened in technology" from "this station has no
            // technology feeds", and those want different next moves.
            ...(asked !== undefined && stories.length === 0
                ? {
                      note:
                          `Nothing the station follows is currently filed under ${asked.label}. That is about this station's feeds rather ` +
                          'than about the world. Read the news without a category, or talk about something else.',
                  }
                : {}),
            stories: stories.map(story => ({
                feedId: story.feedId,
                feedName: story.feedName,
                title: story.title,
                ...(story.summary === undefined ? {} : { summary: story.summary }),
                ...(story.publishedAt === undefined ? {} : { publishedAt: story.publishedAt }),
                // The url and the story's own id are deliberately absent: a model
                // cannot follow a link, and reading one out is the least useful
                // sentence a station can broadcast.
            })),
        };
    }

    /**
     * The categories this station has named, as rules.
     *
     * Read per conversation rather than at boot, for the reason the feeds are asked for per call: an
     * operator adding a category should have the DJ able to ask for it on the next break. A failure
     * is a station with no categories, which is a tool with no `topic` parameter and every other
     * thing it does intact.
     */
    private async categories(): Promise<NewsTopicRules[]> {
        try {
            // Off-air categories are left out: they are a rule about what the station will not read
            // rather than a subject it has, and offering one as a `topic` would teach a model to ask
            // for the material `NewsService` has already withheld. `categoriesOf` skips them too, so
            // the filter below could never match one anyway.
            return (await this.topics.list(NEWS_KIND)).map(newsTopicRules).filter(rule => !rule.offAir);
        } catch {
            return [];
        }
    }
}

/** An argument the model actually set. Blank is the interesting case: a model filling every field. */
/** A story with what its feed says it is attached, which is the one classification signal it does not carry. */
const withFeedCategory = (story: NewsItem, declared: ReadonlyMap<string, string>): ClassifiableStory => {
    const category = declared.get(story.feedId);
    return { ...story, ...(category === undefined ? {} : { feedCategory: category }) };
};

const readText = (value: unknown): string | undefined => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined);

/** Whatever the model asked for, held between one and {@link MAX_RESULTS}. */
function clampLimit(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return MAX_RESULTS;
    return Math.min(MAX_RESULTS, Math.floor(value));
}
