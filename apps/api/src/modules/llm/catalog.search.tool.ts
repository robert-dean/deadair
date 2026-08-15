import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { asCatalogPlugin, type CatalogPlugin } from '#modules/plugins/plugin.capabilities.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
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
 * boundary. A `tool` plugin capability is for services somebody else runs; wrapping the station's
 * own catalog in one would be a boundary crossing in a circle.
 *
 * ## Why it matters more than it looks
 *
 * The grounding rule every writer inherits is that a break names ONLY records the station can play.
 * Without this, the only way to honour that is to hand the model a list up front and hope it is the
 * right list. With it, the model can check, which is the difference between a DJ who says "coming up,
 * something by Boards of Canada" and one who names a track that is not in the library.
 *
 * ## Every provider, not the chosen one
 *
 * Fans out across every active catalog plugin and merges, the way `PlaylistsService` enumerates
 * them. A station with a local library and a streaming account can play from both, so a question
 * about what it has is a question about both. A provider that fails is skipped rather than failing
 * the search: a partial answer is worth more here than none.
 */

/**
 * How many tracks come back at most, whatever was asked for.
 *
 * The same figure {@link LibrarySearchTool} uses, and it is a floor on what a refill can do rather
 * than a comfort: `ModelSetGenerator` is asked for an oversampled batch — two dozen records for a
 * fifteen-item refill — and a model that can see ten cannot name two dozen distinct ones. It was ten
 * here while the library tool's was twenty-five, so the tool for a station's OWN records offered
 * more than the one reaching a provider's entire catalogue, which is backwards: this is the tool
 * that exists for a brief the library cannot fill, and it was the one running out of records first.
 */
const MAX_RESULTS = 25;

/** What one provider is asked for, before the merge trims to {@link MAX_RESULTS}. */
const PER_PROVIDER_LIMIT = 25;

/** One row of the answer. Deliberately thin: a model writing a sentence needs a name, not a schema. */
interface FoundTrack {
    /**
     * The LEAD artist alone, and this is an identity rather than a credit.
     *
     * It was `artists.join(', ')` for as long as this tool existed, which quietly made every
     * collaboration unschedulable. The model is told to copy what a search gave it back exactly —
     * it must be, because {@link ProviderTrackLookup} is strict — so it returned `"Accelio, ROOXG"`
     * as the artist, and both steps that then judge the pick match on the LEAD artist only:
     * `PickResolver.identify` keys it with `songKey(title, [artist])`, and the lookup compares
     * `normalizeKey(track.artists[0])`. Neither can ever equal a joined line, so a record a provider
     * was carrying, that the model had found and named correctly, was dropped as "not in the
     * catalog". Every solo credit in a live run resolved and every collaboration failed.
     *
     * So what this field carries is what those two comparisons are made against, which is the rule
     * every rotation key in the codebase already follows and which {@link LibrarySearchTool} was
     * following all along by answering with `row.artistName`.
     */
    artist: string;
    title: string;
    /**
     * Everyone else on the record, shown and never copied.
     *
     * Here so the answer stays honest — a listing that says a duet is a solo record is worse
     * information to programme from — and separate so it cannot get into {@link artist}. A model
     * choosing between two versions of a title wants to see who else is on them; nothing downstream
     * reads this.
     */
    featuring?: string[];
    album?: string;
    /** Which plugin can play it, so a caller downstream could act on the answer rather than only read it. */
    source: string;
    /**
     * How well known the provider says it is, 0 to 100, when it has an opinion.
     *
     * Shown as well as sorted on, because the model is choosing and this is the one thing on the row
     * that says whether a record is a hit or an obscurity. A brief asking for popular anything is
     * otherwise unservable: a search comes back in the provider's own order, and from a title and an
     * artist alone nothing can tell "Respect by Aretha Franklin" from a bedroom upload. Not every
     * provider has an opinion, and one measured caveat: the station's own Spotify account does not
     * receive this on a search response, so the ordering below is inert for it.
     */
    popularity?: number;
}

@Injectable()
export class CatalogSearchTool implements ToolSource {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly logger: Logger,
    ) {}

    async tools(): Promise<StationTool[]> {
        // Nothing to offer when nothing can be searched. A declaration whose every call answers
        // "no providers" spends context teaching the model about a tool that cannot help it.
        if (this.catalogs().length === 0) return [];

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
     * Every plugin that can be SEARCHED right now.
     *
     * Not every catalog plugin: each catalog method is optional in the SDK, and a provider that
     * lists playlists without offering a search is legitimate. Calling the method anyway would be a
     * `TypeError` in the middle of writing a break, with the model waiting on it.
     */
    private catalogs(): CatalogPlugin[] {
        const searchable: CatalogPlugin[] = [];
        for (const record of this.pluginRegistry.list()) {
            const catalog = asCatalogPlugin(record);
            if (catalog?.searchesTracks === true) searchable.push(catalog);
        }
        return searchable;
    }

    /**
     * One search, across everything.
     *
     * Arguments arrive as the model produced them, so nothing here trusts a type. An empty call is
     * the model's mistake and is reported as one, because "you gave me nothing to search on" is
     * something it can correct and an exception is not.
     *
     * A query is not required on its own: a period is a complete search, and demanding words
     * alongside one made a model that was narrowing correctly invent the filler query `a` to get
     * past the refusal. What IS required is at least one of the three.
     */
    private async search(args: Record<string, unknown>): Promise<{ tracks: FoundTrack[]; searched: number }> {
        const query = readText(args.query) ?? '';
        const limit = clampLimit(args.limit);
        const catalogs = this.catalogs();
        // Passed through untranslated. Each plugin expresses these however its upstream does, and a
        // plugin that cannot express one at all answers with nothing rather than with unfiltered
        // records the merge below could not tell apart. See `MusicProviderCatalog.searchTracks`.
        const filters = {
            ...(readYear(args.yearFrom) === undefined ? {} : { yearFrom: readYear(args.yearFrom)! }),
            ...(readYear(args.yearTo) === undefined ? {} : { yearTo: readYear(args.yearTo)! }),
        };

        if (query.length === 0 && Object.keys(filters).length === 0) {
            throw new Error('a search needs a "query" string, or a year to narrow by');
        }

        const found: FoundTrack[] = [];
        for (const plugin of catalogs) {
            try {
                const tracks = await this.pluginInvoker.invoke(
                    plugin.record.id,
                    'llm.tool.searchTracks',
                    // Non-null because `catalogs()` filtered on `searchesTracks`, which is the same
                    // declaration-and-implementation rule the rest of the host applies.
                    async () => (await plugin.instance.searchTracks!(query, { limit: PER_PROVIDER_LIMIT, ...filters })) ?? [],
                );

                for (const track of tracks) {
                    const [lead, ...featuring] = track.artists ?? [];
                    // A record with nobody credited is left out rather than shown with an empty
                    // artist. It is unnameable: `readPicks` drops a pick with a blank artist and the
                    // lookup refuses to search for one, so offering it can only spend the model's
                    // context on a row it will be penalised for choosing.
                    if (lead === undefined || lead.trim().length === 0) continue;

                    found.push({
                        title: track.title,
                        artist: lead,
                        ...(featuring.length === 0 ? {} : { featuring }),
                        ...(track.album === undefined ? {} : { album: track.album }),
                        source: plugin.record.id,
                        ...(track.popularity === undefined ? {} : { popularity: track.popularity }),
                    });
                }
            } catch (error) {
                // Skipped, not fatal. One provider being down should cost its share of the results
                // rather than the model's ability to check anything at all.
                this.logger.info(`llm: a provider could not be searched (${plugin.record.id}: ${messageOf(error)})`);
            }
        }

        // Ordered by how well known they are when the model gave no words to be relevant TO, and
        // left in the providers' own order when it did.
        //
        // The split is the whole point. A text search has a relevance order that means something —
        // the rows nearest what was typed come first, and re-sorting those by popularity would put
        // an artist's hit above the record actually asked for. A browse has no such order: asked
        // for a period alone, a provider answers with whatever it answers with, and a live run
        // turned "popular rap songs from the USA" into two dozen records nobody has heard of
        // because the first two dozen rows were the first two dozen rows.
        //
        // A provider with no opinion sorts LAST rather than as zero, so a station with one ranked
        // provider and one unranked does not bury the unranked one's whole catalogue — but the
        // ranked rows still lead, which is the point of asking.
        const ordered = query.length === 0 ? [...found].sort(byPopularity) : found;
        const tracks = dedupe(ordered).slice(0, limit);
        // The line `LibrarySearchTool` has had all along, and its absence is why diagnosing a refill
        // that came up short took reading the answer's consequences backwards: the library's search
        // was in the log with its query and its count, and the one that reaches a provider left
        // nothing at all, so "how many records did the model actually have to choose from" was
        // unanswerable for the tool where it matters most.
        this.logger.debug('llm: searched the providers', { query, ...filters, found: tracks.length, providers: catalogs.length });

        return { tracks, searched: catalogs.length };
    }
}

/**
 * Best known first, and anything nobody ranked after all of them.
 *
 * A stable comparator on purpose: rows the providers agree nothing about keep the order they
 * arrived in, so a search that ranks nothing at all is left exactly as it was found rather than
 * shuffled by an arbitrary tie-break.
 */
const byPopularity = (left: FoundTrack, right: FoundTrack): number => {
    if (left.popularity === right.popularity) return 0;
    if (left.popularity === undefined) return 1;
    if (right.popularity === undefined) return -1;
    return right.popularity - left.popularity;
};

/**
 * The same record from two providers is one record to a DJ.
 *
 * By title and artist rather than by id, because the ids are per provider and the whole reason two
 * rows collide here is that they came from different ones.
 *
 * The artist is now the lead alone, so two rows sharing a title and a lead artist and differing only
 * in who is featured collapse into one. That is the correct answer here rather than a loss of
 * precision: `ProviderTrackLookup` matches on exactly those two fields, so a pair this cannot tell
 * apart is a pair the station could not choose between anyway — showing both would offer the model a
 * distinction it has no way to act on.
 */
function dedupe(tracks: readonly FoundTrack[]): FoundTrack[] {
    const seen = new Set<string>();
    const unique: FoundTrack[] = [];

    for (const track of tracks) {
        // `\u0000` written as an escape, not as the literal byte it used to be. A NUL is the right
        // separator — both halves are free text that can contain anything a separator might be, and
        // this is the one character that cannot appear in either, so "Hello " + "World" cannot
        // collide with "Hello" + " World". Written invisibly it was a trap: the same expression
        // typed out by hand somewhere else would build a different key and silently never match.
        const key = `${track.title.toLowerCase()}\u0000${track.artist.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(track);
    }

    return unique;
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

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
