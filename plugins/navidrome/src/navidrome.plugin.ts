import {
    Plugin,
    PluginError,
    baseForm,
    errorText,
    normalize,
    type AlbumEnrichment,
    type AlbumRef,
    type ArtistEnrichment,
    type ArtistRef,
    type EnrichmentMatchKey,
    type GetPlaylistTracksOptions,
    type ListPlaylistsOptions,
    type MusicProviderPluginInstance,
    type PluginConnectionResult,
    type ProviderPlaylist,
    type ProviderStream,
    type ProviderTrack,
    type SearchTracksOptions,
    type TrackEnrichment,
    type TrackRef,
} from '@deadair/plugin-sdk';

import { SubsonicAuth } from './navidrome.auth.js';
import { SubsonicClient, isNotFound } from './navidrome.client.js';
import { mapAlbumEnrichment, mapArtistEnrichment, mapTrackEnrichment } from './navidrome.enrichment.js';
import { mapPlaylist, mapTrack, mapTracks } from './navidrome.mapping.js';
import {
    configSchema,
    ENRICHMENT_CANDIDATES,
    EVERYTHING_PLAYLIST_ID,
    EVERYTHING_PLAYLIST_NAME,
    MAX_PAGE_SIZE,
    type NavidromeConfig,
} from './navidrome.manifest.js';
import { selectSong } from './navidrome.match.js';
import type {
    AlbumResponse,
    ArtistInfoResponse,
    PingResponse,
    PlaylistResponse,
    PlaylistsResponse,
    SearchResponse,
    SongResponse,
    SubsonicArtist,
    SubsonicChild,
} from './navidrome.types.js';

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
 * What a transcode will be.
 *
 * Only stated when we asked for one: with `format=raw` the server sends whatever
 * the file happens to be, and guessing at that from a `suffix` would be a claim
 * this plugin cannot back.
 */
const MIME_TYPES: Record<string, string> = { mp3: 'audio/mpeg', opus: 'audio/ogg' };

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
export class NavidromePlugin extends Plugin implements MusicProviderPluginInstance {
    private client?: SubsonicClient;
    private config?: NavidromeConfig;

    protected async onLoad(): Promise<void> {
        const config = configSchema.parse(await this.host.config.get()) as NavidromeConfig;
        const password = await this.host.secrets.get('password');
        if (!password) throw new PluginError('Navidrome password is not configured').withCode('config');

        this.config = config;
        this.client = new SubsonicClient(this.host, config.baseUrl, new SubsonicAuth(config.username, password));
        this.host.logger.info('navidrome ready', { server: config.baseUrl, user: config.username });
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
            return { ok: false, message: errorText(error) };
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

        // Worth a line, because zero is both plausible and confusing: `getPlaylists`
        // answers with the playlists this account OWNS plus any marked public, so a
        // dedicated deadair account sees none of the ones an operator made under
        // their own login. From outside, that is indistinguishable from a plugin
        // that only ever offers "Everything".
        if (playlists.length === 0) {
            this.host.logger.info('navidrome returned no playlists for this account; only owned and public ones are visible', {
                user: this.config?.username,
            });
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

    // --- stream --------------------------------------------------------------

    /**
     * A URL the player can fetch on its own.
     *
     * This is the ordinary shape the SDK was designed around and the reason this
     * plugin needs no station-side helper: Subsonic authenticates in the query
     * string, so the URL carries its own credentials, which is exactly what the
     * player requires — it fetches with no headers from us.
     *
     * No `expiresAt`. A Subsonic token does not expire, and claiming a lifetime
     * would make the rundown re-resolve URLs that never went stale.
     *
     * Not checked against the library first. A `stream` call for an id the server
     * lost 404s at fetch time, one item is skipped, and the alternative is
     * spending a round trip per item to learn something that can change between
     * the check and the fetch anyway.
     */
    async resolveStreamUrl(trackId: string): Promise<ProviderStream | undefined> {
        const format = this.config?.streamFormat ?? 'raw';

        return {
            url: this.require().url('stream.view', {
                id: trackId,
                format,
                // Only meaningful to a transcode, and Subsonic reads a zero as "no
                // limit" rather than as absent — so an unset one is left out.
                maxBitRate: format === 'raw' ? undefined : this.config?.maxBitRate,
            }),
            ...(format === 'raw' ? {} : { mimeType: MIME_TYPES[format] }),
        };
    }

    // --- enrichment ----------------------------------------------------------

    /**
     * Supplementary, not canonical. MusicBrainz at 100 decides a spelling or a
     * year when both have one; this fills the gaps, and for a track MusicBrainz
     * has never heard of — a bootleg, a self-release, a local band — it is the
     * only description that exists.
     */
    readonly priority = 600;

    /** Subsonic exposes no ISRC, so artist-and-title is the only key there is. */
    readonly matchKeys: EnrichmentMatchKey[] = ['artist-title'];

    /**
     * What the file's own tags say about a recording.
     *
     * `{}` for a track the library does not have, which is the common case on a
     * station whose catalog also holds another provider's tracks. The host reads
     * that as a miss and records it on a short clock rather than as a failure, so
     * a track that is not here costs one search a week.
     *
     * Deliberately no `enrichTracks`. The batch method exists for a source paced
     * at a request per second, where one query answering twenty-five tracks is
     * the difference between one second and twenty-five. Subsonic has no bulk
     * lookup at all, so a batch here would be twenty-five searches under a single
     * chunk deadline instead of twenty-five under twenty-five — strictly worse,
     * because a slow tail would throw away answers the per-ref path keeps.
     */
    async enrichTrack(ref: TrackRef): Promise<Partial<TrackEnrichment>> {
        const song = await this.findSong(ref);
        return song ? mapTrackEnrichment(song) : {};
    }

    /**
     * What the server knows about an artist.
     *
     * `ref.providerRef` is this plugin's own id from last time, so a second pass
     * is a lookup rather than another search. That is the whole reason the host
     * hands it back.
     */
    async enrichArtist(ref: ArtistRef): Promise<Partial<ArtistEnrichment>> {
        const artist = ref.providerRef ? { id: ref.providerRef, name: ref.name } : await this.findArtist(ref.name);
        if (!artist?.id) return {};

        // The biography and the image come from Navidrome's metadata agents, which
        // may have nothing. Cheap enough to always ask, since the id is in hand.
        const body = await this.require().get<ArtistInfoResponse>('getArtistInfo2.view', { id: artist.id });
        return mapArtistEnrichment(artist, body.artistInfo2);
    }

    /** What the tags say about a record. Same `providerRef`-first shape. */
    async enrichAlbum(ref: AlbumRef): Promise<Partial<AlbumEnrichment>> {
        const albumId = ref.providerRef ?? (await this.findAlbumId(ref));
        if (!albumId) return {};

        try {
            const body = await this.require().get<AlbumResponse>('getAlbum.view', { id: albumId });
            return body.album ? mapAlbumEnrichment(body.album, this.artworkUrl(body.album)) : {};
        } catch (error) {
            // A stale `providerRef` — the record was removed, or the library was
            // rescanned into new ids — is a miss, not a failure.
            if (isNotFound(error)) return {};
            throw error;
        }
    }

    protected async onUnload(): Promise<void> {
        this.client = undefined;
        this.config = undefined;
    }

    // --- plumbing ------------------------------------------------------------

    /**
     * The song in the library that is the track being asked about, if any.
     *
     * Searched by artist and title together, then scored: Subsonic search is a
     * substring match with no useful relevance order, so taking the first result
     * would attribute a live version's tags to the album track. See
     * {@link selectSong} for what counts as convincing.
     */
    private async findSong(ref: TrackRef): Promise<SubsonicChild | undefined> {
        const body = await this.require().get<SearchResponse>('search3.view', {
            query: `${ref.artist} ${ref.title}`,
            songCount: ENRICHMENT_CANDIDATES,
            artistCount: 0,
            albumCount: 0,
        });

        return selectSong(body.searchResult3?.song, { artist: ref.artist, title: ref.title, album: ref.album });
    }

    /** The artist by that name, when the library has exactly one convincing candidate. */
    private async findArtist(name: string): Promise<SubsonicArtist | undefined> {
        const body = await this.require().get<SearchResponse>('search3.view', {
            query: name,
            artistCount: ENRICHMENT_CANDIDATES,
            albumCount: 0,
            songCount: 0,
        });

        const wanted = normalize(name);
        return (body.searchResult3?.artist ?? []).find(candidate => candidate.id && candidate.name && normalize(candidate.name) === wanted);
    }

    /** The record's id, matched on title and artist so a same-named record by someone else is not it. */
    private async findAlbumId(ref: AlbumRef): Promise<string | undefined> {
        const body = await this.require().get<SearchResponse>('search3.view', {
            query: `${ref.artist} ${ref.name}`,
            albumCount: ENRICHMENT_CANDIDATES,
            artistCount: 0,
            songCount: 0,
        });

        const wantedName = baseForm(ref.name);
        const wantedArtist = normalize(ref.artist);
        return (body.searchResult3?.album ?? []).find(
            candidate =>
                candidate.id && candidate.name && baseForm(candidate.name) === wantedName && normalize(candidate.artist ?? '') === wantedArtist,
        )?.id;
    }

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
