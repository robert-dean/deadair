import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { catalogKey, normalizeKey } from '#modules/catalog/catalog.keys.js';
import { TracksRepository } from '#modules/catalog/tracks.repository.js';
import { DISCOVER_DEFAULT, DISCOVER_KEY } from '#modules/director/pick.resolver.js';
import { ProviderSearch, type FoundTrack } from '#modules/llm/provider.search.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import type { RequestableTrack } from './types/requests.types.js';

/**
 * Fewer library matches than this and the providers are asked too. The presenter's search tool's
 * number, for the same reason: a library that answered with a handful of rows has answered, and a
 * provider asked anyway costs its rate limit and up to its timeout for rows nobody needed.
 */
export const REQUEST_THIN = 3;

/** How long one term's provider answer is reused, and how many terms are kept. */
export const REQUEST_PROVIDER_TTL_MS = 60_000;
const REQUEST_PROVIDER_CACHE_MAX = 200;

/** How many records the providers are asked for in all, before anything is filtered out. */
const REQUEST_PROVIDER_LIMIT = 25;

interface CacheEntry {
    at: number;
    tracks: FoundTrack[];
}

/**
 * The provider half of the request search: records a music provider carries that the station does
 * not hold yet, so a listener can ask for one.
 *
 * ## Only when the library is thin, and only when the station may take records in
 *
 * A request search runs as somebody types, and every provider is asked in turn with its own timeout,
 * three failures in a row of which quarantine it. So the providers are reached only when the
 * library's answer is thin, never when `rotation.discover` is off (a record from a provider becomes a
 * library record the moment it is asked for, which is exactly what that switch governs), and each
 * term's answer is kept for a minute. The cache is static because this class is scoped: an instance
 * cache would be new, and empty, on every request.
 *
 * ## What is left out
 *
 * Anything the library half already answered with, anything the catalog holds (it is either in the
 * library half or kept out of it for a reason, a dislike or no playable copy, that holds here too),
 * and anything by an artist the station dislikes, credited guests included. The repeat window and
 * the rest of the station's rules are not checked here: the request desk applies them after the
 * record is taken in, and says why in the request's `reason`.
 */
@Injectable()
export class RequestProviderSearch {
    private static readonly cache = new Map<string, CacheEntry>();

    constructor(
        private readonly providers: ProviderSearch,
        private readonly tracks: TracksRepository,
        private readonly registry: PluginRegistry,
        private readonly config: AppConfig,
    ) {}

    /** Whether a search with this many library matches should reach the providers at all. */
    reaches(libraryMatches: number): boolean {
        return libraryMatches < REQUEST_THIN && settingIsOn(this.config, DISCOVER_KEY, DISCOVER_DEFAULT) && this.providers.canSearch();
    }

    /** Provider records for `query`, minus everything above, at most `limit` of them. */
    async search(query: string, library: readonly { title: string; artist: string }[], limit: number): Promise<RequestableTrack[]> {
        const reached = await this.reach(query);
        if (reached.length === 0) return [];

        const [ownership, bannedArtists] = await Promise.all([
            this.tracks.ownership(reached.map(track => ({ title: track.title, artist: track.artist }))),
            this.tracks.dislikedArtistKeys(reached.flatMap(track => [track.artist, ...(track.featuring ?? [])])),
        ]);
        const shown = new Set(library.map(row => keyOf(row.title, row.artist)));

        const rows: RequestableTrack[] = [];
        for (const track of reached) {
            const key = keyOf(track.title, track.artist);
            if (shown.has(key) || ownership.owned.has(key) || ownership.banned.has(key)) continue;
            if ([track.artist, ...(track.featuring ?? [])].some(name => bannedArtists.has(normalizeKey(name)))) continue;

            shown.add(key);
            rows.push({
                source: { pluginId: track.source, externalId: track.externalId },
                sourceName: this.registry.get(track.source)?.manifest?.name ?? track.source,
                title: track.title,
                artist: track.artist,
                ...(track.album === undefined ? {} : { album: track.album }),
                ...(track.year === undefined ? {} : { year: track.year }),
            });
            if (rows.length >= limit) break;
        }
        return rows;
    }

    /** One term's provider answer, from the cache while it is fresh. */
    private async reach(query: string): Promise<FoundTrack[]> {
        const key = query.trim().toLowerCase();
        const cached = RequestProviderSearch.cache.get(key);
        if (cached !== undefined && Date.now() - cached.at < REQUEST_PROVIDER_TTL_MS) return cached.tracks;

        const { tracks } = await this.providers.search(query.trim(), {}, REQUEST_PROVIDER_LIMIT, { operation: 'requests.search.searchTracks' });

        // Oldest out first: a Map iterates in insertion order, and a re-asked term is re-inserted.
        RequestProviderSearch.cache.delete(key);
        if (RequestProviderSearch.cache.size >= REQUEST_PROVIDER_CACHE_MAX) {
            const oldest = RequestProviderSearch.cache.keys().next();
            if (oldest.done !== true) RequestProviderSearch.cache.delete(oldest.value);
        }
        RequestProviderSearch.cache.set(key, { at: Date.now(), tracks });
        return tracks;
    }

    /** For tests: forget every cached answer. */
    static forget(): void {
        RequestProviderSearch.cache.clear();
    }
}

const keyOf = (title: string, artist: string): string => catalogKey(normalizeKey(title), normalizeKey(artist));
