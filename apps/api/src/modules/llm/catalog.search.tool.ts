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

/** How many tracks come back at most, whatever was asked for. */
const MAX_RESULTS = 10;

/** What one provider is asked for, before the merge trims to {@link MAX_RESULTS}. */
const PER_PROVIDER_LIMIT = 10;

/** One row of the answer. Deliberately thin: a model writing a sentence needs a name, not a schema. */
interface FoundTrack {
    title: string;
    artist: string;
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

        const found: FoundTrack[] = [];
        for (const plugin of catalogs) {
            try {
                const tracks = await this.pluginInvoker.invoke(
                    plugin.record.id,
                    'llm.tool.searchTracks',
                    // Non-null because `catalogs()` filtered on `searchesTracks`, which is the same
                    // declaration-and-implementation rule the rest of the host applies.
                    async () => (await plugin.instance.searchTracks!(query, { limit: PER_PROVIDER_LIMIT })) ?? [],
                );

                for (const track of tracks) {
                    found.push({
                        title: track.title,
                        artist: track.artists?.join(', ') ?? '',
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

        return { tracks: dedupe(found).slice(0, limit), searched: catalogs.length };
    }
}

/**
 * The same record from two providers is one record to a DJ.
 *
 * By title and artist rather than by id, because the ids are per provider and the whole reason two
 * rows collide here is that they came from different ones.
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

/** Whatever the model asked for, held between one and {@link MAX_RESULTS}. */
function clampLimit(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return MAX_RESULTS;
    return Math.min(Math.max(Math.floor(value), 1), MAX_RESULTS);
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
