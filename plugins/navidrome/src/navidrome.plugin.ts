import {
    PluginError,
    type GetPlaylistTracksOptions,
    type ListPlaylistsOptions,
    type MusicProviderPluginInstance,
    type PluginConnectionResult,
    type PluginHost,
    type ProviderPlaylist,
    type ProviderTrack,
    type SearchTracksOptions,
} from '@deadair/plugin-sdk';

import { SubsonicAuth } from './navidrome.auth.js';
import { SubsonicClient, isNotFound } from './navidrome.client.js';
import { mapPlaylist, mapTrack, mapTracks } from './navidrome.mapping.js';
import { configSchema, EVERYTHING_PLAYLIST_ID, EVERYTHING_PLAYLIST_NAME, MAX_PAGE_SIZE, type NavidromeConfig } from './navidrome.manifest.js';
import type { PingResponse, PlaylistResponse, PlaylistsResponse, SearchResponse, SongResponse, SubsonicChild } from './navidrome.types.js';

export { navidromeManifest } from './navidrome.manifest.js';

/**
 * A caller's requested page size, kept inside what Subsonic will serve.
 *
 * `undefined` means "the server's default", which is what the protocol does with
 * an absent count, so it is passed through rather than replaced with a number of
 * our own.
 */
const clampCount = (limit: number | undefined): number | undefined => {
    if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return undefined;
    return Math.min(Math.floor(limit), MAX_PAGE_SIZE);
};

/**
 * Navidrome as a deadair `music-provider`: an operator's own library, over the
 * Subsonic API that Navidrome and its relatives all speak.
 *
 * Named for the one server it is tested against rather than for the protocol.
 * The wire format is plain Subsonic and Airsonic, Gonic and LMS would very
 * likely work, but this plugin leans on things that are Navidrome's behaviour
 * rather than the spec's, so a generic name would promise compatibility nothing
 * here checks.
 *
 * The audio path is the ordinary one the SDK was designed around, and the
 * opposite of Spotify's: this plugin mints a URL that carries its own
 * credentials, the player downloads it directly, and no helper process is
 * involved. Nothing here plays audio, so it never declares `steer`; Subsonic's
 * `jukeboxControl` plays to the server machine's own soundcard, which is no use
 * to a station broadcasting to Icecast.
 */
export class NavidromePlugin implements MusicProviderPluginInstance {
    private host?: PluginHost;
    private client?: SubsonicClient;

    async init(host: PluginHost): Promise<void> {
        this.host = host;

        const config = configSchema.parse(await host.config.get()) as NavidromeConfig;
        const password = await host.secrets.get('password');
        if (!password) throw new PluginError('Navidrome password is not configured').withCode('config');

        this.client = new SubsonicClient(host, config.baseUrl, new SubsonicAuth(config.username, password));
        host.logger.info('navidrome ready', { server: config.baseUrl, user: config.username });
    }

    /**
     * `ping` is the whole protocol's health check, and it is authenticated, so a
     * success here proves the URL, the account and the password all at once.
     *
     * Failures are reported rather than thrown: this is the settings card's
     * button, and the operator is mid-typo. The message is theirs to act on.
     */
    async testConnection(): Promise<PluginConnectionResult> {
        try {
            const body = await this.require().get<PingResponse>('ping.view');
            const server = [body.type, body.serverVersion].filter(part => part).join(' ');
            return { ok: true, message: server ? `Connected to ${server}.` : 'Connected.' };
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    }

    // --- catalog -------------------------------------------------------------

    async searchTracks(query: string, options?: SearchTracksOptions): Promise<ProviderTrack[]> {
        const body = await this.require().get<SearchResponse>('search3.view', {
            query,
            songCount: clampCount(options?.limit),
            songOffset: options?.offset,
            // Asking for none of the other two: this method answers about tracks,
            // and a server that would otherwise return twenty albums per page is
            // being asked to do work nothing reads.
            artistCount: 0,
            albumCount: 0,
        });

        return this.toTracks(body.searchResult3?.song);
    }

    async getTrack(trackId: string): Promise<ProviderTrack | undefined> {
        try {
            const body = await this.require().get<SongResponse>('getSong.view', { id: trackId });
            return body.song ? mapTrack(body.song, this.artworkUrl(body.song)) : undefined;
        } catch (error) {
            // A deleted or mistyped id is an answer, not a failure: the catalog asks
            // about ids it stored earlier, and a library gets tracks removed from it.
            if (isNotFound(error)) return undefined;
            throw error;
        }
    }

    /**
     * The server's playlists, plus one that is the whole library.
     *
     * The virtual entry goes last, so an operator's own playlists are what they
     * see first and the catch-all is where they look when there are none.
     */
    async listPlaylists(options?: ListPlaylistsOptions): Promise<ProviderPlaylist[]> {
        const body = await this.require().get<PlaylistsResponse>('getPlaylists.view');

        const playlists: ProviderPlaylist[] = [];
        for (const playlist of body.playlists?.playlist ?? []) {
            const mapped = mapPlaylist(playlist, this.artworkUrl(playlist));
            if (mapped) playlists.push(mapped);
        }
        playlists.push({ id: EVERYTHING_PLAYLIST_ID, name: EVERYTHING_PLAYLIST_NAME, description: 'Every song in the library.' });

        // Subsonic returns the whole list in one response, so paging is applied here
        // rather than asked for. Doing it after the virtual entry is appended keeps
        // it reachable: it is the last item, and a caller walking pages finds it.
        const offset = options?.offset ?? 0;
        const limit = clampCount(options?.limit);
        return limit === undefined ? playlists.slice(offset) : playlists.slice(offset, offset + limit);
    }

    async getPlaylistTracks(playlistId: string, options?: GetPlaylistTracksOptions): Promise<ProviderTrack[]> {
        if (playlistId === EVERYTHING_PLAYLIST_ID) return this.everything(options);

        const body = await this.require().get<PlaylistResponse>('getPlaylist.view', { id: playlistId });

        // `getPlaylist` has no offset or count of its own: it returns every entry,
        // however long the playlist is. The page the caller asked for is taken from
        // what came back rather than pretended at.
        const entries = body.playlist?.entry ?? [];
        const offset = options?.offset ?? 0;
        const limit = clampCount(options?.limit);
        return this.toTracks(limit === undefined ? entries.slice(offset) : entries.slice(offset, offset + limit));
    }

    /**
     * The whole library, paged.
     *
     * `search3` with an empty query is how a Subsonic server is asked for
     * everything, and it honours `songOffset`/`songCount` — which is exactly the
     * contract the catalog sync walks with, one page at a time until a short page
     * ends it. Without this a library with no playlists would sync nothing.
     */
    private async everything(options?: GetPlaylistTracksOptions): Promise<ProviderTrack[]> {
        const body = await this.require().get<SearchResponse>('search3.view', {
            query: '',
            songCount: clampCount(options?.limit) ?? MAX_PAGE_SIZE,
            songOffset: options?.offset,
            artistCount: 0,
            albumCount: 0,
        });

        return this.toTracks(body.searchResult3?.song);
    }

    async dispose(): Promise<void> {
        this.client = undefined;
        this.host = undefined;
    }

    // --- plumbing ------------------------------------------------------------

    /** Songs as `ProviderTrack`s, each with its cover art URL minted. */
    private toTracks(songs: SubsonicChild[] | undefined): ProviderTrack[] {
        return mapTracks(songs, song => this.artworkUrl(song));
    }

    /**
     * A URL for one item's cover art, or nothing when it has none.
     *
     * Credentialed, like everything else Subsonic serves, and built with the
     * stable salt: this URL is *stored* — on a catalog row, and eventually as an
     * `art_assets` key — so it has to be the same string every time it is minted
     * for the same image.
     */
    private artworkUrl(item: { coverArt?: string }): string | undefined {
        if (!item.coverArt || !this.client) return undefined;
        return this.client.url('getCoverArt.view', { id: item.coverArt }, true);
    }

    /** The client, or the honest error for being called before `init`. */
    private require(): SubsonicClient {
        if (!this.client) throw new PluginError('Navidrome plugin used before init()').withCode('config');
        return this.client;
    }
}
