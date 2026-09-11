import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { SearchRecency } from '@deadair/plugin-sdk';
import { SearchService } from '#modules/search/search.service.js';
import type { StationTool, ToolSource } from './llm.tools.js';

/**
 * "What does the web say about this?", as something a model can ask.
 *
 * ## The only source here that answers a question nobody wrote down
 *
 * Every other tool answers out of a list somebody assembled: the library, the
 * providers, the charts a plugin publishes, the feeds the operator subscribed
 * to. Even `read_news`, which is about the world rather than about records, is a
 * menu — the stories are the ones the station's own newsroom chose to carry. This
 * one takes words the model made up and goes and asks.
 *
 * That is what it is FOR, and it is also the whole of what makes it worth being
 * careful about. A break is short of facts; the true things a station can say
 * between two records are otherwise limited to the two records, whatever the
 * station's newsroom happened to file, and what a model already believes.
 *
 * ## Why this one IS backed by a plugin
 *
 * [tool-plugins](https://github.com/robert-dean/deadair/discussions/44)'s rule, the same one `ChartsTool` and `NewsTool`
 * follow: a tool is a plugin when the thing it talks to is somebody else's
 * service. An engine is about as somebody else's as a service gets — a
 * credential, a meter, a rate limit and a response shape that differs per
 * supplier — so all of that lives behind `host.fetch` in `plugins/websearch`,
 * and this file is only the adapter that lets a model reach
 * {@link SearchService}.
 *
 * ## No addresses come back
 *
 * `NewsTool`'s rule, and it matters more here because a search result is mostly
 * its URL: a model cannot follow a link, and reading one out is the least useful
 * sentence a station can broadcast. What comes back instead is `site`, which is
 * the part a presenter can actually say — "according to the Guardian" is a real
 * sentence and `https://www.theguardian.com/music/2026/aug/…` is not.
 *
 * ## Nothing here airs, and nothing here can be played
 *
 * A result is a page. Whether any of it is spoken is a break writer's decision
 * on a station that is on air, and nothing downstream of this touches the pick
 * path — so an engine cannot put a record on the running order by naming one.
 */

/**
 * How many results come back, whatever was asked for.
 *
 * The same figure `NewsTool` uses and for the same reason: these are sentences
 * rather than one-line records. Ten pages with their extracts is already more
 * than a presenter can use in a break, and a model given forty spends its
 * context on a search it was asked to mention once.
 */
const MAX_RESULTS = 10;

/** The windows the capability offers, as the model may name them. */
const RECENCIES: readonly SearchRecency[] = ['day', 'week', 'month', 'year'];

@Injectable()
export class WebSearchTool implements ToolSource {
    constructor(
        private readonly search: SearchService,
        private readonly logger: Logger,
    ) {}

    async tools(): Promise<StationTool[]> {
        // Nothing to offer when no search plugin is installed, which is the
        // default and stays the default until an operator supplies a credential.
        // A declaration whose every call answers "there is no search" spends
        // context teaching the model about a tool that cannot help it — the rule
        // `ChartsTool` and `NewsTool` follow too.
        if (!this.search.hasSearch()) return [];

        return [
            {
                // The widest exposure of the three, because there is no bound on what a page says:
                // an answer here can be a fact about right now, about last week, or about nothing
                // that was ever true. Nothing records when any of it stops holding.
                freshness: 'perishable',
                declaration: {
                    name: 'search_web',
                    // Written for the model, and it says three things
                    // deliberately: what comes back is somebody else's page
                    // rather than the station's own library, that it is worth
                    // reading before saying, and that a page is not a record. The
                    // last one is the important one — every other tool here
                    // answers with music, and a model that reached for this one
                    // to find something to play would get titles it can never
                    // schedule.
                    description:
                        'Look something up on the web: a person, a place, an event, anything the station has no record of. Results are real pages ' +
                        "with the search engine's own extract of each: you can work from them on air, and you should not state details they do not " +
                        'carry. This does not find music to play — use the music search for that.',
                    parameters: {
                        type: 'object',
                        properties: {
                            query: { type: 'string', description: 'What to search for, in the words you would type into a search box.' },
                            recency: {
                                type: 'string',
                                enum: [...RECENCIES],
                                description:
                                    'Only pages this recent. Use it when you are asking what has HAPPENED; leave it out when you are asking what ' +
                                    'something IS, since the best page about a subject is usually an old one.',
                            },
                            limit: { type: 'number', description: `How many results, at most ${MAX_RESULTS}.` },
                        },
                        required: ['query'],
                        additionalProperties: false,
                    },
                },
                run: async args => await this.look(args),
            },
        ];
    }

    /**
     * The results, and a word about them when there are none.
     *
     * A search that found nothing says so rather than answering with a bare
     * empty list, for `NewsTool`'s reason: a model that cannot tell "the web has
     * nothing about this" from "the station's search is broken" will try the
     * same query again, and the second call costs another engine request and
     * another step of a bounded loop.
     */
    private async look(args: Record<string, unknown>): Promise<{ results: unknown[]; note?: string }> {
        const query = readText(args.query);
        if (query === undefined) {
            return { results: [], note: 'A search needs something to search for. Say what you want to know about.' };
        }

        const recency = readRecency(args.recency);
        const found = await this.search.search(query, clampLimit(args.limit), recency === undefined ? {} : { recency });

        // The line every tool here carries: "how much did the model actually
        // have to work with" has to be answerable from the log alone when a
        // break turns out to have mentioned nothing.
        this.logger.debug('llm: searched the web', { query, recency: recency ?? 'any', found: found.length });

        return {
            ...(found.length === 0
                ? {
                      note:
                          `Nothing came back for "${query}". That may be the search rather than the world: try plainer words, or drop the ` +
                          'time limit if you set one. If it still finds nothing, talk about something else.',
                  }
                : {}),
            results: found.map(result => ({
                title: result.title,
                ...(result.snippet.length === 0 ? {} : { extract: result.snippet }),
                ...(result.site === undefined ? {} : { site: result.site }),
                ...(result.publishedAt === undefined ? {} : { publishedAt: result.publishedAt }),
                // The url is deliberately absent. See the class note.
            })),
        };
    }
}

/** An argument the model actually set. Blank is the interesting case: a model filling every field. */
const readText = (value: unknown): string | undefined => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined);

/** A window the capability offers, or nothing. A model naming one it invented is asking for anything. */
const readRecency = (value: unknown): SearchRecency | undefined => RECENCIES.find(recency => recency === value) as SearchRecency | undefined;

/** Whatever the model asked for, held between one and {@link MAX_RESULTS}. */
function clampLimit(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return MAX_RESULTS;
    return Math.min(MAX_RESULTS, Math.floor(value));
}
