import {
    Plugin,
    PluginError,
    configString,
    errorText,
    type GetPlaylistTracksOptions,
    type ListPlaylistsOptions,
    type MusicProviderPluginInstance,
    type PlaybackState,
    type PluginConnectionResult,
    type ProviderPlaylist,
    type ProviderStream,
    type ProviderTrack,
    type SearchTracksOptions,
} from '@deadair/plugin-sdk';
import { SpotifyApi } from '@spotify/web-api-ts-sdk';

import { HostVaultAuthStrategy } from './spotify.auth.js';
import { createHostFetch, SpotifyRequestError, SpotifyResponseValidator } from './spotify.fetch.js';
import {
    buildSearchQuery,
    clampLimit,
    clampSearchLimit,
    clampSearchOffset,
    clampSearchTotal,
    mapPlaybackState,
    mapPlaylist,
    mapTrack,
    quoteIfNeeded,
    SEARCH_OFFSET_MAX,
    type SpotifyPlaylistedItem,
} from './spotify.mapping.js';

export { spotifyManifest } from './spotify.manifest.js';

/** How long a resolved Spotify Connect device id is trusted before the next lookup re-checks it. */
const DEVICE_ID_CACHE_TTL_MS = 60_000;

/** Surfaced when a steer call 404s and there is no device left to fall back on. */
const NO_ACTIVE_DEVICE_MESSAGE = 'no active Spotify device; open Spotify or start the go-librespot bridge';

/**
 * How many artists a genre browse takes records from.
 *
 * Each one is a search, on an account this plugin is careful about the rate limit of, so this is
 * the number that decides what a browse COSTS: six artists is seven calls, which is comfortably
 * more variety than a refill needs. Raising it buys deeper cuts of the same genre at a request
 * each; the reason not to is that a browse runs inside a refill that also has records to fetch.
 */
const BROWSE_ARTISTS = 6;

/** Maps a batch of Spotify items to `ProviderTrack`s, dropping the ones `mapTrack` can't use (nulls, episodes). */
function toProviderTracks(tracks: Parameters<typeof mapTrack>[0][]): ProviderTrack[] {
    const mapped: ProviderTrack[] = [];
    for (const track of tracks) {
        const provider = mapTrack(track);
        if (provider) mapped.push(provider);
    }
    return mapped;
}

/**
 * The Spotify Web API as a deadair `music-provider`, backed by the official
 * `@spotify/web-api-ts-sdk`. Every byte in or out still goes through
 * `host.fetch`: `createHostFetch` (see `spotify.fetch.ts`) is the
 * `RequestImplementation` the SDK is constructed with, so the manifest's
 * hostname allowlist, its rate limiter and its SSRF-safe redirect handling
 * all keep applying. `HostVaultAuthStrategy` (see `spotify.auth.ts`) plays
 * the same role on the authentication side: the host still owns the
 * redirect endpoint and the token vault, which the SDK's own browser-oriented
 * auth strategies assume for themselves.
 *
 * Access tokens are kept in `host.oauth`, never in `host.storage` and never
 * in a log line.
 */
export class SpotifyPlugin extends Plugin implements MusicProviderPluginInstance {
    private clientId?: string;
    private redirectUri?: string;
    private deviceName?: string;
    private auth?: HostVaultAuthStrategy;

    /** Built lazily: `clientId` may be unset until the operator fills in the settings card. */
    private api?: SpotifyApi;

    private deviceIdCache?: { id: string; expiresAt: number };

    /**
     * The connected account's own id, needed to tell an owned playlist from a
     * merely-followed one. Cached for the life of the connection rather than
     * per call: it cannot change without a reconnect, and `listPlaylists`
     * would otherwise spend a second round trip on every listing.
     */
    private currentUserIdCache?: string;

    protected async onLoad(): Promise<void> {
        const config = await this.host.config.get();
        this.clientId = configString(config.clientId);
        this.deviceName = configString(config.deviceName);

        // The operator's registered redirect URI wins; the host-owned endpoint
        // is the fallback for an installation that never filled the field in.
        const configuredRedirect = configString(config.redirectUri);
        // Held in a local as well as on the instance: `this.host` is a getter,
        // and TypeScript drops what it knew about every other property across
        // the call, so reading `this.redirectUri` back would be `string |
        // undefined` one line after it was assigned a string.
        const redirectUri = configuredRedirect ?? (await this.host.oauth.getRedirectUri());
        this.redirectUri = redirectUri;

        this.auth = new HostVaultAuthStrategy(this.host, this.clientId ?? '', redirectUri);

        this.host.logger.info('spotify provider ready', { configured: Boolean(this.clientId) });
    }

    protected async onUnload(): Promise<void> {
        this.clientId = undefined;
        this.redirectUri = undefined;
        this.deviceName = undefined;
        this.auth = undefined;
        this.api = undefined;
        this.currentUserIdCache = undefined;
        this.deviceIdCache = undefined;
    }

    async testConnection(): Promise<PluginConnectionResult> {
        try {
            const profile = await this.getApi().currentUser.profile();
            const who = profile.display_name || profile.id;
            return { ok: true, message: who ? `Connected as ${who}.` : 'Connected.' };
        } catch (error) {
            if (error instanceof SpotifyRequestError) return { ok: false, message: `Spotify replied HTTP ${error.status}.` };
            return { ok: false, message: errorText(error) };
        }
    }

    // --- oauth -------------------------------------------------------------

    async getAuthorizeUrl(state: string): Promise<string> {
        // Lifecycle before configuration: an uninitialized plugin has no
        // `clientId` either, and reporting that first would send the operator
        // to developer.spotify.com to check a setting that is actually fine.
        const auth = this.requireAuth();

        // An empty `clientId` would otherwise mint an authorize URL with
        // `client_id=` and a PKCE verifier the operator can never redeem;
        // fail before either happens.
        if (!this.clientId) throw new PluginError('Spotify client ID is not configured').withCode('config');
        return auth.getAuthorizeUrl(state);
    }

    async handleCallback(params: Record<string, string>): Promise<void> {
        return this.requireAuth().handleCallback(params);
    }

    // --- catalog -----------------------------------------------------------

    /**
     * `clampSearchLimit` rather than `clampLimit`: search caps `limit` at 10
     * since February 2026 while the paged endpoints below still take 50, and it
     * is the one call here that always sends a limit rather than inheriting
     * Spotify's (which dropped to 5 in the same round).
     *
     * That ceiling is per REQUEST, and this pages to meet what the caller asked
     * for. It made one request for as long as it existed, which was correct
     * while the cap was 50 and quietly became a trim when it fell to 10: a
     * caller asking for 25 got 10, and a short answer is also what a genuinely
     * thin search looks like, so nothing downstream could tell the two apart.
     * The station's own reason to care is that `CatalogSearchTool` feeds a model
     * asked to name two dozen distinct records, and a model shown ten pads the
     * answer with repeats.
     *
     * Bounded three ways, because paging an API this plugin is careful about the
     * rate limit of should never be open-ended: {@link clampSearchTotal} caps how
     * many can be asked for at all, a page shorter than requested means the
     * search is exhausted and stops it, and {@link SEARCH_OFFSET_MAX} is the
     * window Spotify itself will page over.
     */
    async searchTracks(query: string, options?: SearchTracksOptions): Promise<ProviderTrack[]> {
        const wanted = clampSearchTotal(options?.limit);

        // A genre with no words to search for is a BROWSE, and it goes somewhere else entirely.
        // `genre:` is a real filter on an ARTIST search and does nothing usable on a track search
        // — see `buildSearchQuery`, which no longer sends it — so the only honest way to answer
        // "what rap is there" is to find the artists and ask what their biggest records are.
        const genre = options?.genre?.trim();
        if (genre !== undefined && genre.length > 0 && query.trim().length === 0) return await this.browseGenre(genre, options, wanted);

        // Spotify's own `year:` dialect, built here because the SDK keeps a filter structured and
        // provider-neutral. A genre alongside text is dropped rather than sent: it would return
        // nothing at all, and the words are what the caller actually wanted found.
        const q = buildSearchQuery(query, options);
        let offset = clampSearchOffset(options?.offset) ?? 0;

        const tracks: ProviderTrack[] = [];
        while (tracks.length < wanted && offset <= SEARCH_OFFSET_MAX) {
            const page = clampSearchLimit(wanted - tracks.length);
            const results = await this.getApi().search(q, ['track'], undefined, page, offset);
            const items = results.tracks.items;

            tracks.push(...toProviderTracks(items));
            // Both of these count what SPOTIFY returned rather than what mapped,
            // because paging is about its cursor and mapping is a filter on top
            // of it. Advancing by the mapped count would re-read whatever it
            // dropped, and a short page of mapped tracks is not an exhausted
            // search — a full page holding two items `mapTrack` cannot use would
            // read as one, and the search would stop with records still to come.
            if (items.length < page) break;
            offset += items.length;
        }

        return tracks.slice(0, wanted);
    }

    /**
     * What a genre sounds like here: its artists' biggest records.
     *
     * ## Why a browse is two calls rather than one filter
     *
     * `genre:` on a track search does not narrow it, measured against the real API: with words it
     * answers with nothing or with unrelated records, and without them it answers with the same two
     * dozen obscure recordings whatever period is asked for. On an ARTIST search it is a real
     * filter, and an artist's top tracks are ranked by Spotify itself — so the pair answers the
     * question a browse is actually asking, which is "who plays this, and what are they known for".
     *
     * That is the path a brief reaches. Asked for "popular rap songs from the USA" the station used
     * to hand a model two dozen bedroom uploads, and the model named them because nothing on the row
     * said which were hits. An artist's own records, ranked by the popularity this now carries, are
     * the hits.
     *
     * ## Why not `artists/{id}/top-tracks`, which is the obvious second call
     *
     * It answers **403 Forbidden** for this application. Measured on the station's own account,
     * where `/search` with the same token answered perfectly well two seconds later, and it is not a
     * scope: that endpoint asks for none. Spotify restricts a set of endpoints per application, and
     * one that cannot be called at all is not worth carrying a fallback for. Searching each artist
     * by NAME needs no market, no extra permission and no second dialect, and it is the same call
     * the plugin already makes for every other search on this page.
     *
     * ## What it costs, and what bounds it
     *
     * One artist search plus one track search per artist, capped at {@link BROWSE_ARTISTS}.
     * Deliberately modest: this runs inside a refill on a rate-limited account, and a browse that
     * spent thirty requests would be a better answer nobody could afford to ask for twice. It stops
     * as soon as `wanted` records are in hand.
     *
     * A period rides along on each of those searches, where `year:` is a filter Spotify does honour.
     */
    private async browseGenre(genre: string, options: SearchTracksOptions | undefined, wanted: number): Promise<ProviderTrack[]> {
        const results = await this.getApi().search(`genre:${quoteIfNeeded(genre)}`, ['artist'], undefined, clampSearchLimit(BROWSE_ARTISTS));
        const names = results.artists.items
            .map(artist => artist.name)
            .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);

        const tracks: ProviderTrack[] = [];
        const seen = new Set<string>();
        for (const name of names.slice(0, BROWSE_ARTISTS)) {
            if (tracks.length >= wanted) break;

            // Straight back through the ordinary search, which is what keeps this one code path
            // rather than two: the same paging, the same clamps, the same year dialect. The name
            // goes as plain text on purpose — a bare name is the search this account is
            // demonstrably allowed to make — and the genre is dropped, having done its job above.
            const perArtist = Math.max(1, Math.ceil(wanted / BROWSE_ARTISTS));
            for (const track of await this.searchTracks(name, { ...options, genre: undefined, limit: perArtist })) {
                // One record can be reached from two artists on a collaboration, and a browse
                // showing it twice would spend one of the model's choices on nothing.
                if (seen.has(track.id)) continue;
                seen.add(track.id);
                tracks.push(track);
            }
        }

        return tracks.slice(0, wanted);
    }

    async getTrack(trackId: string): Promise<ProviderTrack | undefined> {
        try {
            return mapTrack(await this.getApi().tracks.get(trackId));
        } catch (error) {
            if (error instanceof SpotifyRequestError && error.status === 404) return undefined;
            throw error;
        }
    }

    async listPlaylists(options?: ListPlaylistsOptions): Promise<ProviderPlaylist[]> {
        const page = await this.getApi().currentUser.playlists.playlists(clampLimit(options?.limit), options?.offset);
        const currentUserId = await this.getCurrentUserId();

        const playlists: ProviderPlaylist[] = [];
        for (const item of page.items) {
            const mapped = mapPlaylist({ ...item, tracks: item.tracks ?? undefined }, currentUserId);
            if (mapped) playlists.push(mapped);
        }
        return playlists;
    }

    /**
     * Reads `/playlists/{id}/items`, the February 2026 replacement for
     * `/playlists/{id}/tracks`.
     *
     * Hand-rolled through `makeRequest` rather than `playlists.getPlaylistItems`
     * because `@spotify/web-api-ts-sdk` predates the rename and only knows the
     * old path. `makeRequest` is the same door every SDK endpoint goes through,
     * so this still runs on `createHostFetch`: the host's allowlist, rate
     * limiter, bearer refresh and `SpotifyResponseValidator` all keep applying.
     *
     * A 403 here is Spotify refusing a playlist the account neither owns nor
     * collaborates on, and is expected rather than exceptional. `listPlaylists`
     * omits `read` from those playlists' `permissions` so a caller can avoid
     * asking.
     */
    async getPlaylistTracks(playlistId: string, options?: GetPlaylistTracksOptions): Promise<ProviderTrack[]> {
        const query = new URLSearchParams();
        const limit = clampLimit(options?.limit);
        if (limit !== undefined) query.set('limit', String(limit));
        if (options?.offset !== undefined) query.set('offset', String(options.offset));

        const suffix = query.size > 0 ? `?${query.toString()}` : '';
        const path = `playlists/${encodeURIComponent(playlistId)}/items${suffix}`;
        const page = await this.getApi().makeRequest<{ items?: SpotifyPlaylistedItem[] }>('GET', path);

        // `item` is the new key and `track` the deprecated one; both are read
        // so this works either side of the rename.
        return toProviderTracks((page?.items ?? []).map(row => row.item ?? row.track));
    }

    /**
     * A URL the player can fetch this track from.
     *
     * Spotify's audio is the case `host.trackFetcher` exists for: the tracks
     * come off the CDN encrypted, so there is no Spotify URL to mint at all.
     * They are fetched by a separate binary running beside Liquidsoap that
     * speaks Spotify's own protocol, and what it needs from this plugin is a
     * login. So the session goes out through the host, which hands it to that
     * binary and signs a URL on it; the account, the refresh and the vault stay
     * here, and the credentials are never stored on the way past.
     *
     * `undefined` rather than a throw at every step where the answer is "not
     * yet": unconfigured, unauthorised, or a station whose stream half was never
     * set up. All three are ordinary states — the running order simply skips the
     * item — and none of them is worth counting against the plugin's health.
     */
    async resolveStreamUrl(trackId: string): Promise<ProviderStream | undefined> {
        if (!this.clientId || !this.auth) return undefined;

        const tokens = await this.auth.sessionTokens();
        if (!tokens) return undefined;

        // The account id, which is what librespot logs in with. Not cheap to guess
        // at: without it the accesspoint rejects the token, so this one failure is
        // worth reporting rather than swallowing the way the playlist path does.
        const username = await this.getCurrentUserId();
        if (!username) return undefined;

        return this.host.trackFetcher.serve({
            trackId,
            session: { username, accessToken: tokens.accessToken, expiresAt: tokens.expiresAt },
        });
    }

    /**
     * The connected account's id, or `undefined` if asking for it fails.
     *
     * Deliberately swallows: this is only used to decide whether a playlist is
     * worth offering, and failing the whole listing because the profile call
     * blipped would be a worse answer than a listing whose playlists are
     * unmarked. `mapPlaylist` treats a missing id as "no opinion".
     */
    private async getCurrentUserId(): Promise<string | undefined> {
        if (this.currentUserIdCache !== undefined) return this.currentUserIdCache;

        try {
            const profile = await this.getApi().currentUser.profile();
            this.currentUserIdCache = profile.id;
            return profile.id;
        } catch (error) {
            this.host.logger.warn('could not resolve the Spotify account id; playlist permissions will be left unreported', {
                error: errorText(error),
            });
            return undefined;
        }
    }

    // --- steer ---------------------------------------------------------------

    /**
     * Queues tracks in order. Unlike `play`/`pause`/`skip`, this doesn't route
     * through `withDevice`: that retries the whole action on a 404, which
     * here would re-queue the tracks that already landed before a later
     * track's stale device id 404'd. The retry boundary instead sits inside
     * the loop, resuming at the failing track, and the freshly resolved
     * device id is reused for whatever tracks remain rather than re-resolved
     * per track.
     */
    async enqueue(trackIds: string[]): Promise<void> {
        let deviceId = await this.resolveDeviceId(false);
        let hasRetried = false;

        for (const trackId of trackIds) {
            try {
                await this.queueTrack(trackId, deviceId);
                continue;
            } catch (error) {
                if (!this.isNoActiveDevice(error)) throw error;
                if (hasRetried) throw new PluginError(NO_ACTIVE_DEVICE_MESSAGE, { cause: error }).withCode('unavailable');
                if (!this.deviceName) throw new PluginError(NO_ACTIVE_DEVICE_MESSAGE, { cause: error }).withCode('unavailable');
            }

            hasRetried = true;
            deviceId = await this.resolveDeviceId(true);
            try {
                await this.queueTrack(trackId, deviceId);
            } catch (retryError) {
                if (this.isNoActiveDevice(retryError)) throw new PluginError(NO_ACTIVE_DEVICE_MESSAGE, { cause: retryError }).withCode('unavailable');
                throw retryError;
            }
        }
    }

    private async queueTrack(trackId: string, deviceId: string): Promise<void> {
        await this.getApi().player.addItemToPlaybackQueue(`spotify:track:${trackId}`, deviceId);
    }

    async play(trackId?: string): Promise<void> {
        await this.withDevice(deviceId =>
            this.getApi().player.startResumePlayback(deviceId, undefined, trackId ? [`spotify:track:${trackId}`] : undefined),
        );
    }

    async pause(): Promise<void> {
        await this.withDevice(deviceId => this.getApi().player.pausePlayback(deviceId));
    }

    async skip(): Promise<void> {
        await this.withDevice(deviceId => this.getApi().player.skipToNext(deviceId));
    }

    async getPlaybackState(): Promise<PlaybackState> {
        // A 204 (nothing playing) deserializes to `null` on the SDK side,
        // despite the SDK's own return type claiming otherwise.
        const state = await this.getApi().player.getPlaybackState();
        if (!state) return { status: 'stopped' };
        return mapPlaybackState(state);
    }

    // --- device resolution ---------------------------------------------------

    /**
     * Runs `action` against the resolved device id. A 404 means the id was
     * stale or nothing was ever resolved: with `deviceName` configured, that's
     * worth one re-resolve-and-retry, since Spotify Connect device ids churn.
     * With `deviceName` unset, or once the retry also 404s, there is no
     * device left to fall back on.
     */
    private async withDevice<T>(action: (deviceId: string) => Promise<T>): Promise<T> {
        const deviceId = await this.resolveDeviceId(false);

        try {
            return await action(deviceId);
        } catch (error) {
            if (!this.isNoActiveDevice(error)) throw error;
            if (!this.deviceName) throw new PluginError(NO_ACTIVE_DEVICE_MESSAGE, { cause: error }).withCode('unavailable');

            const retryDeviceId = await this.resolveDeviceId(true);
            try {
                return await action(retryDeviceId);
            } catch (retryError) {
                if (this.isNoActiveDevice(retryError)) throw new PluginError(NO_ACTIVE_DEVICE_MESSAGE, { cause: retryError }).withCode('unavailable');
                throw retryError;
            }
        }
    }

    private isNoActiveDevice(error: unknown): error is SpotifyRequestError {
        return error instanceof SpotifyRequestError && error.status === 404;
    }

    /** The device id to steer, or `''` for "whatever device is currently active". */
    private async resolveDeviceId(forceRefresh: boolean): Promise<string> {
        if (!this.deviceName) return '';

        if (!forceRefresh && this.deviceIdCache && this.deviceIdCache.expiresAt > Date.now()) {
            return this.deviceIdCache.id;
        }

        const deviceName = this.deviceName;
        const { devices } = await this.getApi().player.getAvailableDevices();
        const match = devices.find(device => device.id && device.name.toLowerCase() === deviceName.toLowerCase());
        if (!match?.id) throw new PluginError(NO_ACTIVE_DEVICE_MESSAGE).withCode('unavailable');

        this.deviceIdCache = { id: match.id, expiresAt: Date.now() + DEVICE_ID_CACHE_TTL_MS };
        return match.id;
    }

    // --- plumbing ----------------------------------------------------------

    private requireAuth(): HostVaultAuthStrategy {
        if (!this.auth) throw new PluginError('SpotifyPlugin was used before init() or after dispose()').withCode('internal');
        return this.auth;
    }

    private getApi(): SpotifyApi {
        if (this.api) return this.api;

        const auth = this.requireAuth();
        this.api = new SpotifyApi(auth, {
            fetch: createHostFetch(this.host, auth.getBearer, auth.forceRefresh),
            responseValidator: new SpotifyResponseValidator(),
        });
        return this.api;
    }
}
