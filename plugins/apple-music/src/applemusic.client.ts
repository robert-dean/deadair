import { jsonBody, PluginError, type PluginHost, type ProviderPlaylist, type ProviderTrack } from '@deadair/plugin-sdk';
import { APPLE_API_ORIGIN, APPLE_PAGE_SIZE, ITUNES_ORIGIN, ITUNES_PAGE_SIZE, REQUEST_TIMEOUT_MS } from './applemusic.manifest.js';
import { matchesFilters, playlistFromApple, trackFromApple, trackFromItunes, type AppleSong, type ItunesSong } from './applemusic.mapping.js';
import type { DeveloperTokenSource } from './applemusic.token.js';

/**
 * The two ways this plugin reads the catalog, behind one shape.
 *
 * Every request goes through `host.fetch`, which is the only egress a plugin has: it keeps the traffic
 * inside the manifest's `permissions.network` allowlist, bounds the body, and shares the invocation's
 * deadline. Neither client ever reads `this.host` after an `await` — both are handed a host and keep it
 * in a local, which is the pattern the SDK's own helpers follow and the one measured failure the
 * plugin-sdk CLAUDE.md warns about.
 */

export interface SearchFilters {
    limit?: number;
    offset?: number;
    yearFrom?: number;
    yearTo?: number;
}

/** What a catalog source can answer, whichever upstream is behind it. */
export interface AppleCatalog {
    searchTracks(host: PluginHost, query: string, filters: SearchFilters): Promise<ProviderTrack[]>;
    getTrack(host: PluginHost, id: string): Promise<ProviderTrack | undefined>;
    listPlaylists(host: PluginHost): Promise<ProviderPlaylist[]>;
    getPlaylistTracks(host: PluginHost, playlistId: string, options: { limit?: number; offset?: number }): Promise<ProviderTrack[]>;
    /** For `testConnection`, so an operator is told which of the two they are on. */
    readonly label: string;
}

/**
 * The documented Apple Music API, on the operator's own developer token.
 *
 * Every call carries `Authorization: Bearer <token>` and nothing else: there is no Music User Token
 * here, so this reads the public catalog and Apple's own editorial playlists, never a personal library.
 */
export class AppleApiCatalog implements AppleCatalog {
    readonly label = 'Apple Music API';

    constructor(
        private readonly storefront: string,
        private readonly tokens: DeveloperTokenSource,
    ) {}

    private async get(host: PluginHost, path: string, params: Record<string, string | number>): Promise<unknown> {
        const url = new URL(`${APPLE_API_ORIGIN}/catalog/${this.storefront}/${path}`);
        for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

        const response = await host.fetch(url.toString(), {
            headers: { authorization: `Bearer ${this.tokens.get()}` },
            timeoutMs: REQUEST_TIMEOUT_MS,
        });
        if (response.status === 404) {
            // A playlist pasted from another country's store, or a record Apple has withdrawn. That is about
            // the thing asked for rather than the plugin, so it must not count towards setting it aside.
            throw new PluginError(`Apple Music has no ${path} in the ${this.storefront} storefront`).withCode('not_found').withUpstreamStatus(404);
        }
        if (!response.ok) {
            // 401 and 403 are the operator's to fix (a wrong team id, an expired key, a key that was
            // revoked) and everything else is Apple's; both read the same way to a caller, which is why
            // the status is in the message rather than in a branch.
            throw new Error(`Apple Music API answered ${response.status} for ${path}`);
        }
        return jsonBody(response);
    }

    async searchTracks(host: PluginHost, query: string, filters: SearchFilters): Promise<ProviderTrack[]> {
        const wanted = filters.limit ?? 25;
        const results: ProviderTrack[] = [];
        let offset = filters.offset ?? 0;

        // `limit` is a TOTAL, so page until it is met. Apple caps a page at 25 and a short answer is
        // indistinguishable from a genuinely thin search, which is the whole reason for the loop.
        while (results.length < wanted) {
            const body = (await this.get(host, 'search', {
                term: query,
                types: 'songs',
                limit: Math.min(APPLE_PAGE_SIZE, wanted - results.length),
                offset,
            })) as { results?: { songs?: { data?: AppleSong[] } } };

            const page = body.results?.songs?.data ?? [];
            if (page.length === 0) break;

            for (const song of page) {
                const track = trackFromApple(song);
                if (track !== undefined && matchesFilters(track, filters)) results.push(track);
            }
            offset += page.length;
            if (page.length < APPLE_PAGE_SIZE) break;
        }

        return results.slice(0, wanted);
    }

    async getTrack(host: PluginHost, id: string): Promise<ProviderTrack | undefined> {
        const body = (await this.get(host, `songs/${encodeURIComponent(id)}`, {})) as { data?: AppleSong[] };
        const song = body.data?.[0];
        return song === undefined ? undefined : trackFromApple(song);
    }

    /**
     * Apple's own editorial playlists for this storefront, via the charts endpoint.
     *
     * The honest limit: with no Music User Token there is no `me/library/playlists`, so what an operator
     * sees here is what Apple curates rather than what they made. `playlistFromApple` marks every row
     * `madeByProvider` so the console can say so.
     */
    async listPlaylists(host: PluginHost): Promise<ProviderPlaylist[]> {
        const body = (await this.get(host, 'charts', { types: 'playlists', limit: 25 })) as {
            results?: { playlists?: { data?: { id?: string; attributes?: { name?: string; trackCount?: number } }[] }[] };
        };

        const groups = body.results?.playlists ?? [];
        return groups.flatMap(group => (group.data ?? []).flatMap(row => playlistFromApple(row) ?? []));
    }

    async getPlaylistTracks(host: PluginHost, playlistId: string, options: { limit?: number; offset?: number }): Promise<ProviderTrack[]> {
        const wanted = options.limit ?? 100;
        const results: ProviderTrack[] = [];
        let offset = options.offset ?? 0;

        // Never leave a track out of a page: the host reads a short page as the end of the list.
        while (results.length < wanted) {
            const body = (await this.get(host, `playlists/${encodeURIComponent(playlistId)}/tracks`, {
                limit: Math.min(100, wanted - results.length),
                offset,
            })) as { data?: AppleSong[]; next?: string };

            const page = body.data ?? [];
            if (page.length === 0) break;
            for (const song of page) {
                const track = trackFromApple(song);
                if (track !== undefined) results.push(track);
            }
            offset += page.length;
            if (body.next === undefined) break;
        }

        return results.slice(0, wanted);
    }
}

/**
 * The public Search API: no key, no membership, no account.
 *
 * Here because the alternative is that running Apple Music on this station costs $99/year before a
 * single record airs. It answers the SAME catalog ids the player plays — verified end to end, a
 * `trackId` from here played in `stream/apple-player` and the player reported the right title — so a
 * station can search, import and air Apple Music with nothing but a subscription.
 *
 * What it cannot do is carried honestly rather than faked: no ISRC, so its rows do not join to the same
 * recording from another provider; and no playlists at all, so `listPlaylists` answers an empty list and `getPlaylistTracks` refuses.
 */
export class ItunesSearchCatalog implements AppleCatalog {
    readonly label = 'iTunes Search API (no developer key)';

    constructor(private readonly storefront: string) {}

    private async get(host: PluginHost, path: string, params: Record<string, string | number>): Promise<unknown> {
        const url = new URL(`${ITUNES_ORIGIN}/${path}`);
        for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
        // `country` is this API's word for the storefront, so the same setting steers both modes and an
        // operator does not get a US catalog from one and a British one from the other.
        url.searchParams.set('country', this.storefront);

        const response = await host.fetch(url.toString(), { timeoutMs: REQUEST_TIMEOUT_MS });
        if (!response.ok) throw new Error(`the iTunes Search API answered ${response.status} for ${path}`);
        return jsonBody(response);
    }

    async searchTracks(host: PluginHost, query: string, filters: SearchFilters): Promise<ProviderTrack[]> {
        const wanted = filters.limit ?? 25;
        // One request: this API takes an offset only in the sense that it does not, so the page is asked
        // for large and sliced. Its own ceiling is 200.
        const body = (await this.get(host, 'search', {
            term: query,
            entity: 'song',
            media: 'music',
            limit: Math.min(ITUNES_PAGE_SIZE, Math.max(wanted + (filters.offset ?? 0), wanted)),
        })) as { results?: ItunesSong[] };

        const mapped = (body.results ?? []).flatMap(row => trackFromItunes(row) ?? []).filter(row => matchesFilters(row, filters));
        return mapped.slice(filters.offset ?? 0, (filters.offset ?? 0) + wanted);
    }

    async getTrack(host: PluginHost, id: string): Promise<ProviderTrack | undefined> {
        const body = (await this.get(host, 'lookup', { id })) as { results?: ItunesSong[] };
        const row = body.results?.[0];
        return row === undefined ? undefined : trackFromItunes(row);
    }

    /** This API has no concept of a playlist. An empty list is the true answer, not a failure. */
    async listPlaylists(): Promise<ProviderPlaylist[]> {
        return [];
    }

    /**
     * And therefore nothing to read out of one, which is a refusal rather than an empty playlist.
     *
     * The library walk never gets here, because `listPlaylists` offers nothing to walk. What does is a
     * pasted link, and an empty answer would show the operator an empty playlist with no reason given.
     * `unsupported` is about the request rather than the plugin, so it never counts towards setting the
     * plugin aside.
     */
    async getPlaylistTracks(): Promise<ProviderTrack[]> {
        throw new PluginError("Importing an Apple Music playlist needs a MusicKit key. Add one in the Apple Music plugin's settings.").withCode(
            'unsupported',
        );
    }
}

/** Exported for the tests, which assert the mappers rather than the transport. */
export { trackFromApple, trackFromItunes };
