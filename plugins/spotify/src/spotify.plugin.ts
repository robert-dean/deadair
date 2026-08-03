import {
    type GetPlaylistTracksOptions,
    type HostFetchResponse,
    type ListPlaylistsOptions,
    type MusicProviderPluginInstance,
    type PluginConnectionResult,
    type PluginHost,
    type PluginManifest,
    type ProviderPlaylist,
    type ProviderTrack,
    type SearchTracksOptions,
} from '@deadair/plugin-sdk';
import { z } from 'zod';

/**
 * Scopes requested at authorize time. Carried over verbatim from the legacy
 * first-party Spotify client so an existing connection asks for exactly what
 * it used to: the catalog half feeds the rotation pool, the playback half
 * backs the settings card's preview and the Connect session.
 */
const SPOTIFY_SCOPES: string[] = [
    // Catalog / profile — the rotation pool
    'user-read-private',
    'user-read-email',
    'user-library-read',
    'playlist-read-private',
    'playlist-read-collaborative',
    'user-top-read',
    // The shim's session, plus the settings card's playback preview
    'streaming',
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-currently-playing',
] as const;

const ACCOUNTS_ORIGIN = 'https://accounts.spotify.com';
const API_ORIGIN = 'https://api.spotify.com/v1';

/** Refresh this far before the recorded expiry, so a request never races the clock. */
const TOKEN_EXPIRY_SKEW_MS = 30_000;

/** Fallback lifetime when Spotify omits `expires_in`. Spotify's real value is 3600. */
const DEFAULT_TOKEN_LIFETIME_S = 3600;

const REQUEST_TIMEOUT_MS = 10_000;

const configSchema = z.object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    redirectUri: z.url(),
});

export const spotifyManifest: PluginManifest = {
    id: 'deadair.spotify',
    name: 'Spotify',
    version: '0.0.1',
    kind: 'music-provider',
    capabilities: ['catalog', 'oauth'],
    apiVersion: '^1.0.0',
    description: 'Search Spotify, browse your playlists, and pull tracks into the rotation.',
    homepage: 'https://developer.spotify.com/documentation/web-api',
    permissions: {
        network: ['accounts.spotify.com', 'api.spotify.com'],
        storage: true,
        oauth: true,
    },
    configFields: [
        {
            key: 'clientId',
            label: 'Client ID',
            type: 'string',
            required: true,
            help: 'From your app at developer.spotify.com/dashboard.',
        },
        {
            key: 'clientSecret',
            label: 'Client secret',
            type: 'secret',
            required: true,
            help: 'Stored encrypted. Never shown again once saved.',
        },
        {
            key: 'redirectUri',
            label: 'Redirect URI',
            type: 'url',
            required: true,
            help: 'Must match a redirect URI registered on the Spotify app, character for character.',
        },
    ],
    configSchema,
};

/** In-memory view of the OAuth vault's contents. */
interface StoredTokens {
    accessToken: string;
    refreshToken?: string;
    /** Unix epoch millis. */
    expiresAt: number;
}

interface SpotifyImage {
    url?: string;
    width?: number;
    height?: number;
}

interface SpotifyArtist {
    name?: string;
}

interface SpotifyAlbum {
    name?: string;
    images?: SpotifyImage[];
}

interface SpotifyTrack {
    id?: string;
    name?: string;
    artists?: SpotifyArtist[];
    album?: SpotifyAlbum;
    duration_ms?: number;
    external_ids?: { isrc?: string };
}

interface SpotifyPlaylist {
    id?: string;
    name?: string;
    description?: string;
    images?: SpotifyImage[];
    tracks?: { total?: number };
}

interface SpotifyTokenResponse {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
}

interface SpotifyProfile {
    id?: string;
    display_name?: string;
}

function errorText(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

function parseJson<T>(body: string): T | undefined {
    try {
        return JSON.parse(body) as T;
    } catch {
        return undefined;
    }
}

/** Basic-auth header value. `btoa` is fine here: client credentials are ASCII. */
function basicAuth(clientId: string, clientSecret: string): string {
    return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

function applyPaging(search: URLSearchParams, options?: { limit?: number; offset?: number }): void {
    if (options?.limit !== undefined) search.set('limit', String(options.limit));
    if (options?.offset !== undefined) search.set('offset', String(options.offset));
}

/** Spotify returns images widest-first; the first one is the best artwork available. */
function pickArtwork(images?: SpotifyImage[]): string | undefined {
    return images?.[0]?.url;
}

/**
 * A Spotify item is only a usable {@link ProviderTrack} once it has an id and
 * a title. Playlists can contain nulls (removed tracks) and episodes, so this
 * returns `undefined` rather than fabricating a half-empty track.
 */
function mapTrack(track: SpotifyTrack | null | undefined): ProviderTrack | undefined {
    if (!track?.id || !track.name) return undefined;

    return {
        id: track.id,
        title: track.name,
        artists: (track.artists ?? []).map(artist => artist.name).filter((name): name is string => typeof name === 'string' && name.length > 0),
        album: track.album?.name,
        durationMs: track.duration_ms,
        isrc: track.external_ids?.isrc,
        artworkUrl: pickArtwork(track.album?.images),
    };
}

function mapTracks(items: (SpotifyTrack | null | undefined)[] | undefined): ProviderTrack[] {
    const tracks: ProviderTrack[] = [];
    for (const item of items ?? []) {
        const mapped = mapTrack(item);
        if (mapped) tracks.push(mapped);
    }
    return tracks;
}

function mapPlaylist(playlist: SpotifyPlaylist | null | undefined): ProviderPlaylist | undefined {
    if (!playlist?.id || !playlist.name) return undefined;

    return {
        id: playlist.id,
        name: playlist.name,
        description: playlist.description && playlist.description.length > 0 ? playlist.description : undefined,
        trackCount: playlist.tracks?.total,
        artworkUrl: pickArtwork(playlist.images),
    };
}

/**
 * The Spotify Web API as a deadair `music-provider`.
 *
 * Every byte in or out goes through `host.fetch`, which is why the official
 * `@spotify/web-api-ts-sdk` is not used here: its user-authorization flow is a
 * browser redirect dance against `window.location`/`localStorage`, and the
 * host owns the redirect endpoint and the token vault in this architecture.
 * The token exchange, refresh, and catalog calls are therefore issued
 * directly, against the two hostnames the manifest declares.
 *
 * Access tokens are kept in `host.oauth`, never in `host.storage` and never in
 * a log line.
 */
export class SpotifyPlugin implements MusicProviderPluginInstance {
    private host?: PluginHost;
    private clientId?: string;
    private clientSecret?: string;
    private redirectUri?: string;
    private tokens?: StoredTokens;

    /** Coalesces concurrent refreshes so a burst of calls spends one refresh token. */
    private refreshInFlight?: Promise<StoredTokens>;

    async init(host: PluginHost): Promise<void> {
        this.host = host;

        const config = await host.config.get();
        this.clientId = typeof config.clientId === 'string' ? config.clientId : undefined;
        this.clientSecret = await host.secrets.get('clientSecret');

        // The operator's registered redirect URI wins; the host-owned endpoint
        // is the fallback for an installation that never filled the field in.
        const configured = typeof config.redirectUri === 'string' && config.redirectUri.length > 0 ? config.redirectUri : undefined;
        this.redirectUri = configured ?? (await host.oauth.getRedirectUri());

        host.logger.info('spotify provider ready', { configured: Boolean(this.clientId && this.clientSecret) });
    }

    async dispose(): Promise<void> {
        this.host = undefined;
        this.clientId = undefined;
        this.clientSecret = undefined;
        this.redirectUri = undefined;
        this.tokens = undefined;
        this.refreshInFlight = undefined;
    }

    async testConnection(): Promise<PluginConnectionResult> {
        try {
            const response = await this.apiFetch('/me');
            if (!response.ok) return { ok: false, message: `Spotify replied HTTP ${response.status}.` };

            const profile = parseJson<SpotifyProfile>(response.body);
            const who = profile?.display_name ?? profile?.id;
            return { ok: true, message: who ? `Connected as ${who}.` : 'Connected.' };
        } catch (error) {
            return { ok: false, message: errorText(error) };
        }
    }

    // --- oauth -------------------------------------------------------------

    async getAuthorizeUrl(state: string): Promise<string> {
        const url = new URL('/authorize', ACCOUNTS_ORIGIN);
        url.searchParams.set('client_id', this.requireClientId());
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('redirect_uri', this.requireRedirectUri());
        url.searchParams.set('scope', SPOTIFY_SCOPES.join(' '));
        url.searchParams.set('state', state);
        return url.toString();
    }

    async handleCallback(params: Record<string, string>): Promise<void> {
        const denied = params.error;
        if (denied) throw new Error(`Spotify authorisation was refused: ${denied}`);

        const code = params.code;
        if (!code) throw new Error('Spotify callback carried no authorization code');

        const tokens = await this.requestTokens(
            new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: this.requireRedirectUri(),
            }),
        );
        await this.persistTokens(tokens);
        this.host?.logger.info('spotify authorisation completed');
    }

    // --- catalog -----------------------------------------------------------

    async searchTracks(query: string, options?: SearchTracksOptions): Promise<ProviderTrack[]> {
        const search = new URLSearchParams({ q: query, type: 'track' });
        applyPaging(search, options);

        const body = await this.apiJson<{ tracks?: { items?: (SpotifyTrack | null)[] } }>(`/search?${search.toString()}`, 'search');
        return mapTracks(body?.tracks?.items);
    }

    async getTrack(trackId: string): Promise<ProviderTrack | undefined> {
        const response = await this.apiFetch(`/tracks/${encodeURIComponent(trackId)}`);
        if (response.status === 404) return undefined;
        if (!response.ok) throw new Error(`Spotify track lookup failed (HTTP ${response.status})`);

        return mapTrack(parseJson<SpotifyTrack>(response.body));
    }

    async listPlaylists(options?: ListPlaylistsOptions): Promise<ProviderPlaylist[]> {
        const search = new URLSearchParams();
        applyPaging(search, options);

        const query = search.toString();
        const body = await this.apiJson<{ items?: (SpotifyPlaylist | null)[] }>(`/me/playlists${query ? `?${query}` : ''}`, 'playlist listing');

        const playlists: ProviderPlaylist[] = [];
        for (const item of body?.items ?? []) {
            const mapped = mapPlaylist(item);
            if (mapped) playlists.push(mapped);
        }
        return playlists;
    }

    async getPlaylistTracks(playlistId: string, options?: GetPlaylistTracksOptions): Promise<ProviderTrack[]> {
        const search = new URLSearchParams();
        applyPaging(search, options);

        const query = search.toString();
        const path = `/playlists/${encodeURIComponent(playlistId)}/tracks${query ? `?${query}` : ''}`;
        const body = await this.apiJson<{ items?: ({ track?: SpotifyTrack | null } | null)[] }>(path, 'playlist tracks');

        return mapTracks((body?.items ?? []).map(item => item?.track));
    }

    // --- plumbing ----------------------------------------------------------

    private requireHost(): PluginHost {
        if (!this.host) throw new Error('Spotify plugin used before init()');
        return this.host;
    }

    private requireClientId(): string {
        if (!this.clientId) throw new Error('Spotify client ID is not configured');
        return this.clientId;
    }

    private requireClientSecret(): string {
        if (!this.clientSecret) throw new Error('Spotify client secret is not configured');
        return this.clientSecret;
    }

    private requireRedirectUri(): string {
        if (!this.redirectUri) throw new Error('Spotify redirect URI is not configured');
        return this.redirectUri;
    }

    /**
     * A GET against the Web API with a fresh bearer token. A 401 survives one
     * forced refresh and retry: Spotify can invalidate a token before its
     * recorded expiry (password change, scope revocation).
     */
    private async apiFetch(path: string, retryOnUnauthorized = true): Promise<HostFetchResponse> {
        const token = await this.getAccessToken();

        const response = await this.requireHost().fetch(`${API_ORIGIN}${path}`, {
            method: 'GET',
            headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
            timeoutMs: REQUEST_TIMEOUT_MS,
        });

        if (response.status === 401 && retryOnUnauthorized) {
            await this.getAccessToken(true);
            return this.apiFetch(path, false);
        }

        return response;
    }

    private async apiJson<T>(path: string, what: string): Promise<T | undefined> {
        const response = await this.apiFetch(path);
        if (!response.ok) throw new Error(`Spotify ${what} failed (HTTP ${response.status})`);
        return parseJson<T>(response.body);
    }

    /** The current access token, refreshed when it is stale or `force` is set. */
    private async getAccessToken(force = false): Promise<string> {
        const tokens = await this.loadTokens();
        if (!tokens) throw new Error('Spotify is not connected yet; authorise the plugin from its settings card');

        const stale = force || tokens.expiresAt - TOKEN_EXPIRY_SKEW_MS <= Date.now();
        if (!stale) return tokens.accessToken;

        const refreshed = await this.refreshTokens(tokens);
        return refreshed.accessToken;
    }

    private async loadTokens(): Promise<StoredTokens | undefined> {
        if (this.tokens) return this.tokens;

        const stored = await this.requireHost().oauth.getTokens();
        const accessToken = stored?.accessToken;
        if (!accessToken) return undefined;

        const expiresAt = Number(stored?.expiresAt);
        this.tokens = {
            accessToken,
            refreshToken: stored?.refreshToken,
            // An unparseable expiry is treated as "expired": worst case that
            // costs one refresh round-trip, versus a guaranteed 401 otherwise.
            expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
        };
        return this.tokens;
    }

    private async refreshTokens(current: StoredTokens): Promise<StoredTokens> {
        if (!current.refreshToken) {
            throw new Error('Spotify access token has expired and no refresh token is stored; re-authorise the plugin');
        }

        this.refreshInFlight ??= this.performRefresh(current.refreshToken).finally(() => {
            this.refreshInFlight = undefined;
        });

        return this.refreshInFlight;
    }

    private async performRefresh(refreshToken: string): Promise<StoredTokens> {
        // Spotify may or may not rotate the refresh token; keep the old one
        // when the response omits it, or the connection dies after one hour.
        const tokens = await this.requestTokens(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }), refreshToken);
        await this.persistTokens(tokens);
        return tokens;
    }

    private async requestTokens(body: URLSearchParams, existingRefreshToken?: string): Promise<StoredTokens> {
        const response = await this.requireHost().fetch(`${ACCOUNTS_ORIGIN}/api/token`, {
            method: 'POST',
            headers: {
                authorization: basicAuth(this.requireClientId(), this.requireClientSecret()),
                'content-type': 'application/x-www-form-urlencoded',
            },
            body: body.toString(),
            timeoutMs: REQUEST_TIMEOUT_MS,
        });

        // Deliberately not echoing the response body: it carries tokens.
        if (!response.ok) throw new Error(`Spotify token request failed (HTTP ${response.status})`);

        const payload = parseJson<SpotifyTokenResponse>(response.body);
        const accessToken = payload?.access_token;
        if (!accessToken) throw new Error('Spotify token response carried no access token');

        return {
            accessToken,
            refreshToken: payload?.refresh_token ?? existingRefreshToken,
            expiresAt: Date.now() + (payload?.expires_in ?? DEFAULT_TOKEN_LIFETIME_S) * 1000,
        };
    }

    private async persistTokens(tokens: StoredTokens): Promise<void> {
        this.tokens = tokens;

        const record: Record<string, string> = {
            accessToken: tokens.accessToken,
            expiresAt: String(tokens.expiresAt),
        };
        if (tokens.refreshToken) record.refreshToken = tokens.refreshToken;

        await this.requireHost().oauth.saveTokens(record);
    }
}
