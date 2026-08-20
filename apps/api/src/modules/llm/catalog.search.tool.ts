import { Injectable } from 'injectkit';
import { ProviderSearch } from './provider.search.js';
import type { StationTool, ToolSource } from './llm.tools.js';

/**
 * "What can the station REACH?", as something a model can ask.
 *
 * ## The question it answers changed, and the description had to change with it
 *
 * This used to be "do we actually have this record", and the honest answer was no: it searches the
 * providers, and a record a provider carries was not something the station could play — a pick only
 * survived if `PickResolver` matched `deadair.tracks`, so anything found here and named was dropped.
 * The description said the opposite, which was the whole reason `LibrarySearchTool` had to exist.
 *
 * `PickResolver` now has the lookup rung, so a named record the catalog has never seen is found at a
 * provider, ingested and aired. That makes these results genuinely schedulable and turns the two
 * tools into a real pair rather than a trap: {@link LibrarySearchTool} answers with what the station
 * HAS, this answers with what it can GET, and the descriptions say which is which. Preferring the
 * library is still right — those records are catalogued, often already on disk, and measured — but
 * reaching past it is no longer a mistake.
 *
 * ## Why this is not a plugin
 *
 * `searchTracks` is already on the `music.provider` capability and every provider plugin implements
 * it. So this is the host exposing something it can already do, not a new integration and not a new
 * boundary. A `tool` plugin capability is for services somebody else runs; wrapping the station's own
 * catalog in one would be a boundary crossing in a circle.
 *
 * ## The fan-out itself is {@link ProviderSearch}
 *
 * Everything about reaching the plugins — which ones can be searched, skipping one that failed, the
 * lead-artist split, the merge and its ordering — moved there when a second caller needed it. What
 * stays here is what a MODEL is told and how its arguments are read, which is the only part that was
 * ever about this being a tool.
 */

/**
 * How many tracks come back at most, whatever was asked for.
 *
 * The same figure `LibrarySearchTool` uses, and it is a floor on what a refill can do rather than a
 * comfort: `ModelSetGenerator` is asked for an oversampled batch — two dozen records for a fifteen-item
 * refill — and a model that can see ten cannot name two dozen distinct ones. It was ten here while the
 * library tool's was twenty-five, so the tool for a station's OWN records offered more than the one
 * reaching a provider's entire catalogue, which is backwards: this is the tool that exists for a brief
 * the library cannot fill, and it was the one running out of records first.
 */
const MAX_RESULTS = 25;

@Injectable()
export class CatalogSearchTool implements ToolSource {
    constructor(private readonly providers: ProviderSearch) {}

    async tools(): Promise<StationTool[]> {
        // Nothing to offer when nothing can be searched. A declaration whose every call answers
        // "no providers" spends context teaching the model about a tool that cannot help it.
        if (!this.providers.canSearch()) return [];

        return [
            {
                declaration: {
                    name: 'search_catalog',
                    // Written for the model rather than for a developer: this text is the entire
                    // basis on which it decides whether to call the thing.
                    description:
                        "Search everything the station's music providers offer, by artist or title, including records the station does not own yet. Choosing one makes the station fetch it, so its results are safe to name. Prefer search_library first, and use this to reach a record the library does not have. It matches NAMES, not styles: to fill a brief, work out for yourself which artists fit it and search for them one at a time.",
                    parameters: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                description:
                                    'An artist, a title, or both. An artist name on its own is the search this answers best. A style like "rap" finds records with that word in the title, not records of that style.',
                            },
                            // There is no `genre` here, and the absence is measured rather than an
                            // oversight. It went to the provider as a filter for as long as this
                            // tool existed; on the station's own account it returned nothing at all
                            // beside an artist name, and obscure records nobody has heard of on its
                            // own. A model narrowing exactly as it had been told to was handed junk,
                            // and named it. Turning a style into artists is the one thing a model
                            // does better than this search does, so that is where it now happens —
                            // and the description above says so, because a rule stated nowhere is a
                            // rule the model cannot follow.
                            yearFrom: { type: 'number', description: 'Narrow to records released in or after this year.' },
                            yearTo: { type: 'number', description: 'Narrow to records released in or before this year.' },
                            limit: { type: 'number', description: `How many results, at most ${MAX_RESULTS}.` },
                        },
                        // Nothing is required, because a period is a complete search on its own. What
                        // the call actually needs is one of the three, which `search` below enforces
                        // and says: a model refused for sending no query worked around it by passing
                        // the query `a`, which is not a no-op but a text match that steers the answer.
                        required: [],
                        additionalProperties: false,
                    },
                },
                run: async args => await this.search(args),
            },
        ];
    }

    /**
     * One search, as the model asked for it.
     *
     * Arguments arrive as the model produced them, so nothing here trusts a type. An empty call is
     * the model's mistake and is reported as one, because "you gave me nothing to search on" is
     * something it can correct and an exception is not.
     *
     * A query is not required on its own: a period is a complete search, and demanding words
     * alongside one made a model that was narrowing correctly invent the filler query `a` to get past
     * the refusal. What IS required is at least one of the three.
     */
    private async search(args: Record<string, unknown>) {
        const query = readText(args.query) ?? '';
        const filters = {
            ...(readYear(args.yearFrom) === undefined ? {} : { yearFrom: readYear(args.yearFrom)! }),
            ...(readYear(args.yearTo) === undefined ? {} : { yearTo: readYear(args.yearTo)! }),
        };

        if (query.length === 0 && Object.keys(filters).length === 0) {
            throw new Error('a search needs a "query" string, or a year to narrow by');
        }

        return await this.providers.search(query, filters, clampLimit(args.limit));
    }
}

/**
 * Text the model actually set, or nothing.
 *
 * Arguments arrive as the model produced them, so a value is taken only when it is usable and of the
 * right type. Absent is the ordinary case and blank is the interesting one: a model that fills every
 * parameter in a declaration sends `query: ""`, which is not a search, it is everything.
 */
const readText = (value: unknown): string | undefined => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined);

/** A year the model set, ignoring anything that is not one. */
const readYear = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;

/** Whatever the model asked for, held between one and {@link MAX_RESULTS}. */
function clampLimit(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return MAX_RESULTS;
    return Math.min(Math.max(Math.floor(value), 1), MAX_RESULTS);
}
