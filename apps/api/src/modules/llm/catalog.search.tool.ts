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
                        "Search everything the station's music providers offer, by title or artist, including records the station does not own yet. Choosing one makes the station fetch it, so its results are safe to name. Prefer search_library first, and use this to reach a record the library does not have.",
                    parameters: {
                        type: 'object',
                        properties: {
                            query: { type: 'string', description: 'A title, an artist, or both.' },
                            // The three filters exist because `query` is matched against titles and
                            // artist names and nothing else, which is not a detail the model can be
                            // expected to infer: asked for "jazz club hits" it searched those words
                            // and got back obscure records literally titled "Jazz Club". Saying so
                            // in the description is most of the fix, since a parameter a model does
                            // not know the point of is a parameter it does not use.
                            genre: {
                                type: 'string',
                                description:
                                    'Narrow to a style, e.g. "jazz". Use this instead of putting the style in query: query only matches titles and artist names.',
                            },
                            yearFrom: { type: 'number', description: 'Narrow to records released in or after this year.' },
                            yearTo: { type: 'number', description: 'Narrow to records released in or before this year.' },
                            limit: { type: 'number', description: `How many results, at most ${MAX_RESULTS}.` },
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
     * Arguments arrive as the model produced them, so nothing here trusts a type. A missing or
     * non-string query is the model's mistake and is reported as one, because "I could not read
     * your query" is something it can correct and an exception is not.
     */
    private async search(args: Record<string, unknown>): Promise<{ tracks: FoundTrack[]; searched: number }> {
        const query = typeof args.query === 'string' ? args.query.trim() : '';
        if (query.length === 0) throw new Error('a search needs a "query" string');

        const limit = clampLimit(args.limit);
        const catalogs = this.catalogs();
        // Passed through untranslated. Each plugin expresses these however its upstream does, and a
        // plugin that cannot express one at all answers with nothing rather than with unfiltered
        // records the merge below could not tell apart. See `MusicProviderCatalog.searchTracks`.
        const filters = {
            ...(readText(args.genre) === undefined ? {} : { genre: readText(args.genre)! }),
            ...(readYear(args.yearFrom) === undefined ? {} : { yearFrom: readYear(args.yearFrom)! }),
            ...(readYear(args.yearTo) === undefined ? {} : { yearTo: readYear(args.yearTo)! }),
        };

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
                    });
                }
            } catch (error) {
                // Skipped, not fatal. One provider being down should cost its share of the results
                // rather than the model's ability to check anything at all.
                this.logger.info(`llm: a provider could not be searched (${plugin.record.id}: ${messageOf(error)})`);
            }
        }

        const tracks = dedupe(found).slice(0, limit);
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
 * A filter the model actually set, or nothing.
 *
 * Arguments arrive as the model produced them, so a filter is taken only when it is a usable value
 * of the right type. Absent is the ordinary case and blank is the interesting one: a model that
 * fills every parameter in a declaration would otherwise send `genre: ""`, and a provider handed an
 * empty narrowing either declines outright or searches for nothing.
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
