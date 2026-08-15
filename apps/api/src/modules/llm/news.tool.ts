import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { NewsService } from '#modules/news/news.service.js';
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
 * `docs/todo/tool-plugins.md`'s rule: a tool is a plugin when the thing it talks
 * to is somebody else's service, and a host-side source when it talks to
 * deadair. Every feed here belongs to a publisher, so the egress, the rate
 * bucket and the shape of the document live behind `host.fetch` in a plugin, and
 * this file is only the adapter that lets a model reach {@link NewsService}.
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
        private readonly logger: Logger,
    ) {}

    async tools(): Promise<StationTool[]> {
        // Nothing to offer when no news plugin is installed, which is the
        // default. A declaration whose every call answers "there is no news"
        // spends context teaching the model about a tool that cannot help it —
        // the rule `ChartsTool` and `CatalogSearchTool` both follow.
        if (!this.news.hasNews()) return [];

        return [
            {
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
                run: async args => await this.read(args),
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
    private async read(args: Record<string, unknown>): Promise<{ feeds: FeedOption[]; stories: unknown[] }> {
        const feedId = readText(args.feedId);
        const since = readText(args.since);
        const stories = await this.news.fetchItems({
            ...(feedId === undefined ? {} : { feedId }),
            limit: clampLimit(args.limit),
            ...(since === undefined ? {} : { since }),
        });

        const feeds = (await this.news.listFeeds()).map(feed => ({
            id: feed.id,
            name: feed.name,
            ...(feed.category === undefined ? {} : { category: feed.category }),
        }));

        // The line every tool here carries: "how many stories did the model
        // actually have to work with" has to be answerable from the log alone
        // when a break turns out to have mentioned nothing.
        this.logger.debug('llm: read the news', { feedId: feedId ?? 'all', found: stories.length });

        return {
            feeds,
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
}

/** An argument the model actually set. Blank is the interesting case: a model filling every field. */
const readText = (value: unknown): string | undefined => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined);

/** Whatever the model asked for, held between one and {@link MAX_RESULTS}. */
function clampLimit(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return MAX_RESULTS;
    return Math.min(MAX_RESULTS, Math.floor(value));
}
