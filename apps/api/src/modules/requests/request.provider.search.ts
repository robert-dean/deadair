import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { catalogKey, normalizeKey } from '#modules/catalog/catalog.keys.js';
import { TracksRepository } from '#modules/catalog/tracks.repository.js';
import { DISCOVER_DEFAULT, DISCOVER_KEY } from '#modules/director/pick.resolver.js';
import { ProviderSearch, type FoundTrack } from '#modules/llm/provider.search.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { RequestSearchLimiter } from './request.search.limiter.js';
import type { RequestableTrack } from './types/requests.types.js';

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
 * ## On every search, but only when the station may take records in
 *
 * A listener searching an artist the library holds three records by wants the rest of them, so the
 * providers are asked whatever the library answered, and fill whatever room the library left on the
 * page. The model's search tool stops at a thin library because a model asking for a record wants one;
 * a person browsing wants the catalogue. What keeps that affordable is on both sides: the apps
 * debounce the search box, so a term is sent once the typing settles rather than per letter, and each
 * term's answer is kept here for a minute, since every provider is asked in turn with its own timeout
 * and three failures in a row quarantine it. The cache is static because this class is scoped: an
 * instance cache would be new, and empty, on every request.
 *
 * Neither of those binds a caller who is not one of the apps, so the server does its own debouncing.
 * A term already being asked about joins that search rather than starting a second, and a term that
 * would reach the providers fresh spends one of the caller's allowance and one of the station's
 * (`RequestSearchLimiter`). Out of either, the search answers with the library alone, uncached, so the
 * same term asked again once the budget refills is asked properly. Never when `rotation.discover` is off: a
 * record from a provider becomes a library record the moment it is asked for, which is exactly what
 * that switch governs.
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
    private static readonly inFlight = new Map<string, Promise<FoundTrack[]>>();

    constructor(
        private readonly providers: ProviderSearch,
        private readonly tracks: TracksRepository,
        private readonly registry: PluginRegistry,
        private readonly config: AppConfig,
        private readonly limiter: RequestSearchLimiter,
    ) {}

    /** Whether a search should reach the providers at all. */
    reaches(): boolean {
        return settingIsOn(this.config, DISCOVER_KEY, DISCOVER_DEFAULT) && this.providers.canSearch();
    }

    /**
     * Provider records for `query`, minus everything above, at most `limit` of them. `callerKey` is
     * whose allowance a fresh provider search is spent from.
     */
    async search(query: string, library: readonly { title: string; artist: string }[], limit: number, callerKey: string): Promise<RequestableTrack[]> {
        const reached = await this.reach(query, callerKey);
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

    /**
     * One term's provider answer: from the cache while it is fresh, from the search already asking
     * about it if there is one, and otherwise from the providers if the caller and the station both
     * have the allowance. Nothing, and nothing cached, when they do not.
     */
    private async reach(query: string, callerKey: string): Promise<FoundTrack[]> {
        const key = query.trim().toLowerCase();
        const cached = RequestProviderSearch.cache.get(key);
        if (cached !== undefined && Date.now() - cached.at < REQUEST_PROVIDER_TTL_MS) return cached.tracks;

        const pending = RequestProviderSearch.inFlight.get(key);
        if (pending !== undefined) return pending;

        // Registered before the wait on the limiter, so a second caller arriving during it joins
        // rather than spending an allowance of its own on the same term.
        const asking = this.ask(query.trim(), key, callerKey);
        RequestProviderSearch.inFlight.set(key, asking);
        try {
            return await asking;
        } finally {
            RequestProviderSearch.inFlight.delete(key);
        }
    }

    /** Ask the providers about one term if the allowance is there, and keep the answer for a minute. */
    private async ask(query: string, key: string, callerKey: string): Promise<FoundTrack[]> {
        if (!(await this.limiter.allows(callerKey))) return [];

        const { tracks } = await this.providers.search(query, {}, REQUEST_PROVIDER_LIMIT, { operation: 'requests.search.searchTracks' });

        // Oldest out first: a Map iterates in insertion order, and a re-asked term is re-inserted.
        RequestProviderSearch.cache.delete(key);
        if (RequestProviderSearch.cache.size >= REQUEST_PROVIDER_CACHE_MAX) {
            const oldest = RequestProviderSearch.cache.keys().next();
            if (oldest.done !== true) RequestProviderSearch.cache.delete(oldest.value);
        }
        RequestProviderSearch.cache.set(key, { at: Date.now(), tracks });
        return tracks;
    }

    /** For tests: forget every cached answer and every search in flight. */
    static forget(): void {
        RequestProviderSearch.cache.clear();
        RequestProviderSearch.inFlight.clear();
    }
}

const keyOf = (title: string, artist: string): string => catalogKey(normalizeKey(title), normalizeKey(artist));
