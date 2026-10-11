import {
    Plugin,
    type GetPlaylistTracksOptions,
    type MusicProviderCatalog,
    type MusicProviderStream,
    type PluginHost,
    type ProviderPlaylist,
    type ProviderStream,
    type ProviderTrack,
    type SearchTracksOptions,
    type PluginConnectionResult,
} from '@deadair/plugin-sdk';
import { AppleApiCatalog, ItunesSearchCatalog, type AppleCatalog } from './applemusic.client.js';
import { configSchema, hasDeveloperKey, type AppleMusicConfig } from './applemusic.manifest.js';
import { applePlaylistIdFromUrl } from './applemusic.mapping.js';
import { DeveloperTokenSource } from './applemusic.token.js';

/**
 * Apple Music, as a catalog you can search and a record the station can air.
 *
 * Two halves that have almost nothing to do with each other, which is worth knowing before reading:
 *
 * **The catalog half** is ordinary HTTP against a documented API, in one of two modes depending on
 * whether the operator configured a MusicKit key. See `applemusic.client.ts`.
 *
 * **The audio half is one line.** There is no Apple Music URL to mint at any price — the audio is DRM
 * protected end to end and the only open asset is a 30-second preview — so `resolveStreamUrl` asks the
 * host for a URL on `stream/apple-player`, a container that runs Apple's own web player and records what
 * it plays. The station signs that URL; this plugin holds no secret and decrypts nothing.
 */
export class AppleMusicPlugin extends Plugin implements MusicProviderCatalog, MusicProviderStream {
    private catalog: AppleCatalog | undefined;

    /**
     * Built on first use rather than in `init`, because it depends on config and config is read
     * asynchronously. Cleared by `dispose`, and an operator saving new credentials reinitializes the
     * whole instance, so there is no cache to invalidate beyond this field.
     */
    private async source(host: PluginHost): Promise<AppleCatalog> {
        if (this.catalog !== undefined) return this.catalog;

        const raw = await host.config.get();
        const parsed = configSchema.safeParse(raw);
        const config: AppleMusicConfig = parsed.success ? parsed.data : { storefront: 'us' };

        if (hasDeveloperKey(config)) {
            const tokens = new DeveloperTokenSource({ teamId: config.teamId!, keyId: config.keyId!, privateKey: config.privateKey! });
            this.catalog = new AppleApiCatalog(config.storefront, tokens);
        } else {
            this.catalog = new ItunesSearchCatalog(config.storefront);
        }
        return this.catalog;
    }

    async testConnection(): Promise<PluginConnectionResult> {
        // `const host = this.host` before the first await, every time. A config save mid-request
        // reinitializes the plugin and the getter then throws; the measured cost of getting this wrong
        // was a failed search becoming an invoker failure, and three of those quarantine the plugin.
        const host = this.host;
        try {
            const catalog = await this.source(host);
            const found = await catalog.searchTracks(host, 'portishead', { limit: 1 });
            return {
                ok: found.length > 0,
                message:
                    found.length > 0
                        ? `Connected through the ${catalog.label}.`
                        : `Reached the ${catalog.label}, but it found nothing — check the storefront.`,
            };
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    }

    async searchTracks(query: string, options?: SearchTracksOptions): Promise<ProviderTrack[]> {
        const host = this.host;
        const catalog = await this.source(host);
        const found = await catalog.searchTracks(host, query, {
            ...(options?.limit === undefined ? {} : { limit: options.limit }),
            ...(options?.offset === undefined ? {} : { offset: options.offset }),
            ...(options?.yearFrom === undefined ? {} : { yearFrom: options.yearFrom }),
            ...(options?.yearTo === undefined ? {} : { yearTo: options.yearTo }),
        });
        return found;
    }

    async getTrack(trackId: string): Promise<ProviderTrack | undefined> {
        const host = this.host;
        const catalog = await this.source(host);
        return catalog.getTrack(host, trackId);
    }

    /**
     * Claims every Apple Music playlist link, with a developer key or without one.
     *
     * Without a key there is nothing to read the playlist with, and `getPlaylistTracks` says so. Claiming
     * the link anyway is what puts that sentence in front of the operator: left unclaimed, they are told
     * no source recognises a link that is plainly Apple's.
     */
    playlistIdFromUrl(url: string): string | undefined {
        return applePlaylistIdFromUrl(url);
    }

    async listPlaylists(): Promise<ProviderPlaylist[]> {
        const host = this.host;
        const catalog = await this.source(host);
        return catalog.listPlaylists(host);
    }

    async getPlaylistTracks(playlistId: string, options?: GetPlaylistTracksOptions): Promise<ProviderTrack[]> {
        const host = this.host;
        const catalog = await this.source(host);
        const found = await catalog.getPlaylistTracks(host, playlistId, {
            ...(options?.limit === undefined ? {} : { limit: options.limit }),
            ...(options?.offset === undefined ? {} : { offset: options.offset }),
        });
        return found;
    }

    /**
     * Where the station fetches this record from, which is a player rather than a provider.
     *
     * One line, and everything interesting about it is somewhere else. `servePlayer` answers `undefined`
     * when the operator has no player container configured, which is passed straight through: an item
     * nobody can resolve is skipped, not an error. The URL that comes back is signed by the host and
     * carries `fetchBudgetMs`, because a capture runs in real time and the station's ordinary 90-second
     * fetch ceiling would cut every record off mid-song.
     */
    async resolveStreamUrl(trackId: string): Promise<ProviderStream | undefined> {
        return this.host.trackFetcher.servePlayer({ trackId });
    }
}
