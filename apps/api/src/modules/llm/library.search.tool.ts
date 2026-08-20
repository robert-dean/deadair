import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { TracksRepository } from '#modules/catalog/tracks.repository.js';
import { advisoryPolicy, demandsClean } from '#modules/director/advisory.policy.js';
import type { StationTool, ToolSource } from './llm.tools.js';

/**
 * "What is actually in the station's library?", as something a model can ask.
 *
 * ## Why this is not {@link CatalogSearchTool}
 *
 * That one fans out across every provider PLUGIN and asks what it can REACH. This asks what the
 * station HAS: what has been catalogued and bound.
 *
 * The difference used to be that only this one's results could be scheduled at all — a pick that
 * matched no catalog row was dropped, so a DJ steered by provider search produced a running order
 * that came back short for reasons nothing in the log connected to the search. That is no longer
 * true: `PickResolver` looks a missing record up at the providers and ingests it, so both tools
 * answer with records that can air.
 *
 * What survives is a preference, and it is a real one. A record here is already catalogued, often
 * already on disk, and measured, so it costs nothing to play and airs trimmed. One from the other
 * tool costs a lookup, an ingest and a download, and airs untrimmed until the analysis pass reaches
 * it. So this is where a picker looks first, and the other is how it reaches something the station
 * does not own — which is the whole point of being able to programme against a brief the library
 * cannot fill. The descriptions carry that ordering, because that text is the entire basis on which
 * the model decides.
 *
 * ## Bans filter this tool. Rotation rules do not.
 *
 * A disliked record is excluded, because a dislike is an instruction about what the station may
 * play and offering one is offering something the operator forbade. A record inside the repeat
 * window is NOT excluded, and that is deliberate rather than an oversight: variety is enforced at
 * the point of choice, and a tool that pre-filtered it would return a worse pool on a small library
 * while hiding from the model the very thing it is supposed to be reasoning about. See
 * `docs/todo/station-intelligence.md` §1.
 *
 * A `clean-only` station falls on the BAN side of that line, and the two `prefer-` states fall on
 * the rotation-rule side. The split is the same one: clean-only means a record with no clean copy
 * cannot air at all, so offering it is offering something that will be named and lost, while a
 * preference is satisfied by choosing between two copies of a work that is playable either way.
 *
 * ## An empty answer says where to look instead, and says it harder the second time
 *
 * `{"tracks":[]}` is a true answer and a useless one: it reports that the station does not own the
 * record without saying that another tool can reach it. Measured on a `artists like mitch murder`
 * refill against a library of rock and metal — the model found the artist at a provider, asked
 * `similar_artists` for its neighbours, then searched the LIBRARY for each neighbour in turn, got
 * nothing every time, and ran out of tool steps before it ever answered. Twenty-four records came
 * from the brief-blind floor instead, and nothing in the log connected the two facts.
 *
 * So an empty result carries a `note`, and the note escalates. Once is a fact about one query and
 * the suggestion is to reach past it. {@link EMPTY_RUN_BEFORE_STOP} in a row is a fact about the
 * LIBRARY — a station whose catalogue does not hold this kind of music at all — and the note stops
 * suggesting and starts telling, because the failure is not one bad search, it is a loop.
 *
 * The count is per instance and this source is scoped per invocation, so it describes THIS
 * generation's searches. A hit resets it: a library that answered once is not a library to give up
 * on, and the run being counted is a run of misses rather than a tally of them.
 *
 * What it deliberately does NOT do is search the providers itself and fold the results in. The two
 * tools answer different questions — what the station HAS against what it can GET — and a record
 * from here is catalogued, usually on disk and measured, where one from `search_catalog` costs a
 * lookup, an ingest and a download and airs untrimmed. Merging them would hand the model a list it
 * could no longer tell apart, which is the preference the pair exists to express.
 */

/** How many records come back at most, whatever was asked for. */
const MAX_RESULTS = 25;

/**
 * Empty searches in a row before the note stops suggesting and starts instructing.
 *
 * Two rather than one, because the first miss is ordinary — a title spelt differently, an artist the
 * station holds under another name — and telling a model to abandon the library over it would push
 * every refill onto the slower path for a query it could have fixed. Two in a row is the shape of
 * the failure this exists for: a brief the catalogue has nothing of, being asked about one artist at
 * a time.
 */
const EMPTY_RUN_BEFORE_STOP = 2;

/** One row of the answer. Thin on purpose: a model choosing a record needs names, not a schema. */
interface LibraryTrack {
    title: string;
    artist: string;
    album?: string;
    year?: number;
    genre?: string;
}

/**
 * One search's answer.
 *
 * The `note` is present only when there is something to say, which today is only ever an empty
 * result. A field carrying an encouraging sentence beside twenty-five records would be context spent
 * telling a model that the thing it just succeeded at worked.
 */
interface LibraryAnswer {
    tracks: LibraryTrack[];
    note?: string;
}

@Injectable()
export class LibrarySearchTool implements ToolSource {
    /**
     * Searches that have come back empty in a row, this invocation.
     *
     * Not a total. What is being detected is a model working through a list of names the library
     * cannot answer for, so a hit anywhere in the middle means it is not in that loop.
     */
    private emptyRun = 0;

    constructor(
        private readonly tracks: TracksRepository,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    async tools(): Promise<StationTool[]> {
        return [
            {
                declaration: {
                    name: 'search_library',
                    // Written for the model, not for a developer. The contrast with
                    // `search_catalog` is stated because both are on offer and choosing wrongly is
                    // the failure this tool exists to prevent.
                    description:
                        "Search the station's own library: records it already owns, ready to play. Look here FIRST when choosing what to play. If the library cannot fill what you were asked for, use search_catalog to reach a record the station does not own yet.",
                    parameters: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                // Says genre explicitly because a model programming an hour reaches
                                // for a style first, and because every result carries one. A field
                                // handed back but not accepted back reads as an empty library.
                                //
                                // "every style it is tagged with" rather than "its genre", because
                                // `searchPlayable` now matches the whole tag list a plugin found and
                                // not only the one promoted onto the row. A model told it can search
                                // the genre it was SHOWN searches the one word it was shown.
                                description:
                                    'A title, an artist, or a style. Matches part of any of them, and a record is found under every style it or its artist is tagged with — not just the one shown in the results.',
                            },
                            limit: { type: 'number', description: `How many records, at most ${MAX_RESULTS}.` },
                        },
                        required: ['query'],
                        additionalProperties: false,
                    },
                },
                run: async args => await this.search(args),
            },
        ];
    }

    /**
     * One search of the library.
     *
     * Arguments arrive as the model produced them, so nothing here trusts a type. A missing or
     * non-string query is reported as an error the model can read and correct, which is what
     * `ToolRegistry` turns every throw into.
     */
    private async search(args: Record<string, unknown>): Promise<LibraryAnswer> {
        const query = typeof args.query === 'string' ? args.query.trim() : '';
        if (query.length === 0) throw new Error('a search needs a "query" string');

        // Read per call, like every other setting: an operator switching the station to clean-only
        // is obeyed by the next thing the model asks rather than after a restart.
        const rows = await this.tracks.searchPlayable(query, clampLimit(args.limit), demandsClean(advisoryPolicy(this.config)));
        this.logger.debug('llm: searched the library', { query, found: rows.length });

        if (rows.length === 0) {
            this.emptyRun += 1;
            // Logged, because the shape this counts is the one that cost a whole refill and the run
            // length is the only thing that says a model is in the loop rather than having missed
            // once. `info` at the point it becomes an instruction, so the line is a finding rather
            // than a running commentary on every thin search.
            if (this.emptyRun >= EMPTY_RUN_BEFORE_STOP) {
                this.logger.info('llm: the library has come back empty repeatedly; the model has been told to search the providers instead', {
                    query,
                    emptyRun: this.emptyRun,
                });
            }
            return { tracks: [], note: this.emptyNote(query) };
        }

        this.emptyRun = 0;
        return {
            tracks: rows.map(row => ({
                title: row.title,
                artist: row.artistName,
                ...(row.albumName == null ? {} : { album: row.albumName }),
                ...(row.year == null ? {} : { year: row.year }),
                ...(row.genre == null ? {} : { genre: row.genre }),
            })),
        };
    }

    /**
     * What an empty answer says to do next.
     *
     * Both versions name `search_catalog` and both say its results are safe to name, because a model
     * sent to a tool it has been told to prefer LESS needs the reason it is allowed to: the pick is
     * looked up, ingested and aired, so reaching past the library costs a download rather than a
     * dropped record.
     *
     * The second version withdraws the library rather than merely ranking it lower. "Prefer X" is
     * what the model was already following when it searched here for the fourth artist in a row, so
     * a stronger version of the same preference would change nothing.
     */
    private emptyNote(query: string): string {
        if (this.emptyRun < EMPTY_RUN_BEFORE_STOP) {
            return `The station's own library holds nothing matching "${query}". Use search_catalog to reach it: a record found there is fetched and played like any other, so it is safe to name.`;
        }

        return (
            `The library has now come back empty ${this.emptyRun} times in a row, most recently for "${query}". ` +
            `It does not hold this kind of music, so searching it for more names like this one will keep returning nothing and will spend the whole request. ` +
            `Use search_catalog for the rest of this set: its records are fetched and played like any other, so they are safe to name.`
        );
    }
}

/**
 * The requested limit, or the ceiling.
 *
 * A model asking for four hundred records is asking for its own context to be filled with a library
 * listing, so the ceiling is enforced rather than honoured. A nonsense value falls back to the
 * ceiling rather than erroring: the query is the part worth failing over.
 */
function clampLimit(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return MAX_RESULTS;
    return Math.min(MAX_RESULTS, Math.floor(value));
}
