import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { TracksRepository } from '#modules/catalog/tracks.repository.js';
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
 */

/** How many records come back at most, whatever was asked for. */
const MAX_RESULTS = 25;

/** One row of the answer. Thin on purpose: a model choosing a record needs names, not a schema. */
interface LibraryTrack {
    title: string;
    artist: string;
    album?: string;
    year?: number;
    genre?: string;
}

@Injectable()
export class LibrarySearchTool implements ToolSource {
    constructor(
        private readonly tracks: TracksRepository,
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
                                description: 'A title, an artist, or a genre. Matches part of any of them.',
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
    private async search(args: Record<string, unknown>): Promise<{ tracks: LibraryTrack[] }> {
        const query = typeof args.query === 'string' ? args.query.trim() : '';
        if (query.length === 0) throw new Error('a search needs a "query" string');

        const rows = await this.tracks.searchPlayable(query, clampLimit(args.limit));
        this.logger.debug('llm: searched the library', { query, found: rows.length });

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
