import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { asCatalogPlugin, type CatalogPlugin } from '#modules/plugins/plugin.capabilities.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';

/**
 * Asking every provider plugin what it carries, merged into one answer.
 *
 * ## Why this is not a tool
 *
 * It was the whole body of the tool that used to fan out, and it stayed there for as long as that was
 * the only thing reaching the providers. `MusicSearchTool` needs the same fan-out as HALF of its
 * answer, so what a MODEL is offered and what the station can REACH are separated: this answers the
 * second question and holds no declaration, no argument parsing and no opinion about how a model
 * should be told to use it.
 *
 * Everything below is the behaviour that was already there, unchanged, and each rule is load-bearing:
 *
 * ## Every provider, not the chosen one
 *
 * Fans out across every active catalog plugin and merges, the way `PlaylistsService` enumerates them.
 * A station with a local library and a streaming account can play from both, so a question about what
 * it can reach is a question about both. A provider that FAILS is skipped rather than failing the
 * search: a partial answer is worth more here than none, and one provider being down should not cost
 * the caller its ability to check anything at all.
 *
 * ## The lead artist is an identity, and the rest is a credit
 *
 * {@link FoundTrack.artist} is the lead alone. It was `artists.join(', ')` for as long as this code
 * existed, which quietly made every collaboration unschedulable: a model is told to copy a search
 * result back exactly, and both steps that then judge the pick match on the lead artist only —
 * `PickResolver.identify` keys it with `songKey(title, [artist])`, and `ProviderTrackLookup` compares
 * `normalizeKey(track.artists[0])`. Neither can ever equal a joined line, so a record a provider was
 * carrying, that the model had found and named correctly, was dropped as "not in the catalog". Every
 * solo credit in a live run resolved and every collaboration failed. The other credits ride in
 * {@link FoundTrack.featuring}, which is shown and never copied.
 */

/** What one provider is asked for, before the merge trims to the caller's limit. */
const PER_PROVIDER_LIMIT = 25;

/** One record a provider carries. Deliberately thin: a model choosing one needs a name, not a schema. */
export interface FoundTrack {
    /** The LEAD artist alone, which is what every downstream comparison is made against. */
    artist: string;
    title: string;
    /** Everyone else on the record, shown and never copied. Nothing downstream reads this. */
    featuring?: string[];
    album?: string;
    /** Which plugin can play it, so a caller can act on the answer rather than only read it. */
    source: string;
    /**
     * How well known the provider says it is, 0 to 100, when it has an opinion.
     *
     * The one field on the row that says whether a record is a hit or an obscurity, without which a
     * brief asking for popular anything is unservable: a search comes back in the provider's own
     * order, and from a title and an artist alone nothing tells "Respect by Aretha Franklin" from a
     * bedroom upload. One measured caveat: the station's own Spotify account does not receive this
     * on a search response, so the ordering below is inert for it.
     */
    popularity?: number;
}

/** What a caller narrows by. Passed to the plugins untranslated; each expresses it however its upstream does. */
export interface ProviderSearchFilters {
    yearFrom?: number;
    yearTo?: number;
}

@Injectable()
export class ProviderSearch {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly logger: Logger,
    ) {}

    /**
     * Every plugin that can be SEARCHED right now.
     *
     * Not every catalog plugin: each catalog method is optional in the SDK, and a provider that lists
     * playlists without offering a search is legitimate. Calling the method anyway would be a
     * `TypeError` in the middle of writing a break, with the model waiting on it.
     */
    catalogs(): CatalogPlugin[] {
        const searchable: CatalogPlugin[] = [];
        for (const record of this.pluginRegistry.list()) {
            const catalog = asCatalogPlugin(record);
            if (catalog?.searchesTracks === true) searchable.push(catalog);
        }
        return searchable;
    }

    /** Whether anything can be searched at all, which is what decides if a tool is worth declaring. */
    canSearch(): boolean {
        return this.catalogs().length > 0;
    }

    /**
     * One search, across everything.
     *
     * A query is not required: a period is a complete search on its own. What the caller must supply
     * is one of the two, and enforcing that is the caller's job rather than this one's — a tool has a
     * sentence to give the model, and this has an empty list.
     */
    async search(query: string, filters: ProviderSearchFilters, limit: number): Promise<{ tracks: FoundTrack[]; searched: number }> {
        const catalogs = this.catalogs();
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
                // rather than the caller's ability to check anything at all.
                this.logger.info(`llm: a provider could not be searched (${plugin.record.id}: ${messageOf(error)})`);
            }
        }

        // Ordered by how well known they are when the caller gave no words to be relevant TO, and
        // left in the providers' own order when it did.
        //
        // The split is the whole point. A text search has a relevance order that means something —
        // the rows nearest what was typed come first, and re-sorting those by popularity would put
        // an artist's hit above the record actually asked for. A browse has no such order: asked for
        // a period alone, a provider answers with whatever it answers with, and a live run turned
        // "popular rap songs from the USA" into two dozen records nobody has heard of because the
        // first two dozen rows were the first two dozen rows.
        //
        // A provider with no opinion sorts LAST rather than as zero, so a station with one ranked
        // provider and one unranked does not bury the unranked one's whole catalogue — but the
        // ranked rows still lead, which is the point of asking.
        const ordered = query.length === 0 ? [...found].sort(byPopularity) : found;
        const tracks = dedupe(ordered).slice(0, limit);
        this.logger.debug('llm: searched the providers', { query, ...filters, found: tracks.length, providers: catalogs.length });

        return { tracks, searched: catalogs.length };
    }
}

/**
 * Best known first, and anything nobody ranked after all of them.
 *
 * A stable comparator on purpose: rows the providers agree nothing about keep the order they arrived
 * in, so a search that ranks nothing at all is left exactly as it was found rather than shuffled by
 * an arbitrary tie-break.
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
 * The artist is the lead alone, so two rows sharing a title and a lead artist and differing only in
 * who is featured collapse into one. That is the correct answer rather than a loss of precision:
 * `ProviderTrackLookup` matches on exactly those two fields, so a pair this cannot tell apart is a
 * pair the station could not choose between anyway — showing both would offer a distinction nothing
 * downstream can act on.
 */
export function dedupe(tracks: readonly FoundTrack[]): FoundTrack[] {
    const seen = new Set<string>();
    const unique: FoundTrack[] = [];

    for (const track of tracks) {
        // `\u0000` written as an escape, not as the literal byte it used to be. A NUL is the right
        // separator — both halves are free text that can contain anything a separator might be, and
        // this is the one character that cannot appear in either, so "Hello " + "World" cannot
        // collide with "Hello" + " World". Written invisibly it was a trap: the same expression typed
        // out by hand somewhere else would build a different key and silently never match.
        const key = providerKey(track.title, track.artist);
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(track);
    }

    return unique;
}

/** The key {@link dedupe} collapses on, exported so a caller merging another source uses the same one. */
export const providerKey = (title: string, artist: string): string => `${title.toLowerCase()}\u0000${artist.toLowerCase()}`;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
