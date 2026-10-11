import {
    Plugin,
    PluginError,
    errorText,
    normalize,
    type AlbumEnrichment,
    type AlbumRef,
    type ArtistEnrichment,
    type ArtistRef,
    type EnrichmentMatchKey,
    type EnrichmentProvider,
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

import { JellyfinClient, isMissing, type JellyfinParams } from './jellyfin.client.js';
import { mapAlbumEnrichment, mapArtistEnrichment, mapTrackEnrichment } from './jellyfin.enrichment.js';
import { ITEM_ID, jellyfinPlaylistIdFromUrl, mapPlaylist, mapTracks, text } from './jellyfin.mapping.js';
import {
    ARTIST_PROBE_LIMIT,
    ARTIST_SEARCHES,
    configSchema,
    EVERYTHING_PLAYLIST_ID,
    EVERYTHING_PLAYLIST_NAME,
    MAX_PAGE_SIZE,
    type JellyfinConfig,
} from './jellyfin.manifest.js';
import { selectAlbum, selectArtist, selectTrack } from './jellyfin.match.js';
import { artistProbe, artistReadings, longestWord, titleMatches, yearsFilter, type ArtistReading } from './jellyfin.search.js';
import type { JellyfinItem, JellyfinQueryResult, JellyfinSystemInfo, JellyfinUser } from './jellyfin.types.js';

export { jellyfinManifest } from './jellyfin.manifest.js';

/** The fields an enrichment answer is read from, which a listing leaves out unless asked. */
const ENRICHMENT_FIELDS = 'ProviderIds,Genres,Overview,Studios,PremiereDate';

/** How many tracks a search answers when the caller did not say. */
const DEFAULT_SEARCH_LIMIT = 50;

/**
 * A caller's requested page size, kept inside {@link MAX_PAGE_SIZE}.
 *
 * `undefined` means the caller did not say, which each method answers in its
 * own way rather than this inventing a number.
 */
const clampCount = (limit: number | undefined): number | undefined => {
    if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return undefined;
    return Math.min(Math.floor(limit), MAX_PAGE_SIZE);
};

/** What a transcode will be. Only stated when one was asked for: an original file is whatever it is. */
const MIME_TYPES: Record<string, string> = { mp3: 'audio/mpeg', opus: 'audio/ogg' };

/** The `/Items` parameters every track query shares. */
const AUDIO: JellyfinParams = { IncludeItemTypes: 'Audio', Recursive: 'true', EnableTotalRecordCount: 'false' };

/**
 * Jellyfin as a deadair `music-provider`: an operator's own library on their
 * own media server.
 *
 * The audio path is the ordinary one the SDK was designed around, the same as
 * Navidrome's: this plugin mints a URL carrying its own credentials, the player
 * downloads it directly, and no helper process is involved. Nothing here plays
 * audio, so it never declares `steer`.
 *
 * Every request is made as one Jellyfin user, named in the settings. An API key
 * belongs to no user, and Jellyfin refuses to list a playlist's contents
 * without one; the user's library access also decides what the station sees.
 */
export class JellyfinPlugin extends Plugin implements MusicProviderPluginInstance, EnrichmentProvider {
    private client?: JellyfinClient;
    private config?: JellyfinConfig;
    /** The configured user's id, looked up once per load. A promise, so concurrent first calls share one lookup. */
    private user?: Promise<string>;

    protected async onLoad(): Promise<void> {
        const host = this.host;
        const config = configSchema.parse(await host.config.get()) as JellyfinConfig;
        const apiKey = await host.secrets.get('apiKey');
        if (!apiKey) throw new PluginError('Jellyfin API key is not configured').withCode('config');

        this.config = config;
        this.client = new JellyfinClient(host, config.baseUrl, apiKey);
        host.logger.info('jellyfin ready', { server: config.baseUrl, user: config.username });
    }

    /**
     * Proves the URL, the key and the user together: `/System/Info` needs a key
     * the server accepts, and the user lookup needs the name to exist.
     *
     * Failures are reported rather than thrown: this is the settings card's
     * button, and the operator is mid-typo.
     */
    async testConnection(): Promise<PluginConnectionResult> {
        try {
            const client = this.require();
            const info = await client.get<JellyfinSystemInfo>('/System/Info');
            await this.userId();
            const server = [text(info.ProductName) ?? 'Jellyfin', text(info.Version)].filter(part => part).join(' ');
            return { ok: true, message: `Connected to ${server} as ${this.config?.username}.` };
        } catch (error) {
            return { ok: false, message: errorText(error) };
        }
    }

    // --- catalog -------------------------------------------------------------

    /**
     * Tracks a free-text query names, read two ways at once.
     *
     * As a title, which is what Jellyfin's search does on its own. And as an
     * artist followed by a title, which is how the station phrases every lookup
     * and which a name-only search cannot match: see `jellyfin.search.ts`. The
     * artist-scoped answers come first, because a track that matched on both
     * the artist and the title is the stronger reading.
     *
     * A period IS applied, through Jellyfin's `Years` filter, so a track whose
     * file carries no year is left out of a period search. That is the filter
     * honoured as written rather than widened: this provider cannot say "or
     * unknown", and answering with undated tracks would hand the station records
     * nothing marks as outside the period it asked for.
     */
    async searchTracks(query: string, options?: SearchTracksOptions): Promise<ProviderTrack[]> {
        const client = this.require();
        const years = yearsFilter(options?.yearFrom, options?.yearTo);
        if (years === '') return [];

        const offset = Math.max(Math.floor(options?.offset ?? 0), 0);
        const wanted = Math.min(offset + (clampCount(options?.limit) ?? DEFAULT_SEARCH_LIMIT), MAX_PAGE_SIZE);
        const userId = await this.userId();
        const base: JellyfinParams = { ...AUDIO, userId, Years: years, Limit: wanted };

        const probe = artistProbe(query);
        const [byTitle, artists] = await Promise.all([
            client.get<JellyfinQueryResult>('/Items', { ...base, searchTerm: query }),
            probe === undefined
                ? Promise.resolve<JellyfinQueryResult>({})
                : client.get<JellyfinQueryResult>('/Artists', {
                      userId,
                      searchTerm: probe,
                      Limit: ARTIST_PROBE_LIMIT,
                      EnableTotalRecordCount: 'false',
                  }),
        ]);

        const readings = artistReadings(
            query,
            (artists.Items ?? []).flatMap(artist => (artist.Id && text(artist.Name) ? [{ id: artist.Id, name: text(artist.Name)! }] : [])),
        ).slice(0, ARTIST_SEARCHES);
        const byArtist = await Promise.all(readings.map(reading => this.artistTracks(client, base, reading)));

        const seen = new Set<string>();
        const merged: JellyfinItem[] = [];
        for (const item of [...byArtist.flat(), ...(byTitle.Items ?? [])]) {
            if (!item.Id || seen.has(item.Id)) continue;
            seen.add(item.Id);
            merged.push(item);
        }

        return this.toTracks(merged).slice(offset, wanted);
    }

    /**
     * One artist's tracks whose title is the rest of the query.
     *
     * The title is matched HERE rather than by the server, because Jellyfin's
     * search compares punctuation literally: measured on 10.11.0, `mr brightside`
     * found nothing and `Mr. Brightside` found the track, and the station's
     * spelling of a title comes from whichever provider it met the record on. So
     * the artist's tracks are read and compared in the SDK's normal form. An
     * artist with more tracks than one page holds is also searched by the
     * longest word of the title, so a prolific artist's record is not lost past
     * the first page.
     */
    private async artistTracks(client: JellyfinClient, base: JellyfinParams, reading: ArtistReading): Promise<JellyfinItem[]> {
        if (reading.rest === '') return (await client.get<JellyfinQueryResult>('/Items', { ...base, ArtistIds: reading.id })).Items ?? [];

        const scoped: JellyfinParams = { ...base, ArtistIds: reading.id, SortBy: 'SortName', Limit: MAX_PAGE_SIZE };
        let candidates = (await client.get<JellyfinQueryResult>('/Items', scoped)).Items ?? [];
        const word = longestWord(reading.rest);
        if (candidates.length >= MAX_PAGE_SIZE && word !== undefined) {
            candidates = [...candidates, ...((await client.get<JellyfinQueryResult>('/Items', { ...scoped, searchTerm: word })).Items ?? [])];
        }
        return titleMatches(candidates, reading.rest);
    }

    /**
     * One track by the id it was stored under.
     *
     * Asked through the `ids` filter rather than `/Items/{id}`, because a filter
     * that matches nothing answers an empty list where the path answers an error
     * that differs between releases. The id is checked first: measured on 10.11.0,
     * an `ids` value Jellyfin cannot parse is IGNORED, and the query answers with
     * the user's top-level folders instead of nothing.
     */
    async getTrack(trackId: string): Promise<ProviderTrack | undefined> {
        if (!ITEM_ID.test(trackId)) return undefined;

        const client = this.require();
        const body = await client.get<JellyfinQueryResult>('/Items', { userId: await this.userId(), ids: trackId });
        const item = (body.Items ?? []).find(candidate => candidate.Id?.toLowerCase() === trackId.toLowerCase());
        return item ? this.toTracks([item])[0] : undefined;
    }

    /** A pasted link into this server's web app, as the item id it names. */
    playlistIdFromUrl(url: string): string | undefined {
        return jellyfinPlaylistIdFromUrl(url, this.config?.baseUrl);
    }

    /**
     * The server's audio playlists, plus one that is the whole library.
     *
     * Fetched whole and paged here, so the virtual entry can go last and still be
     * reached by a caller walking pages: an operator's own playlists are what they
     * see first, and the catch-all is where they look when there are none.
     */
    async listPlaylists(options?: ListPlaylistsOptions): Promise<ProviderPlaylist[]> {
        const client = this.require();
        const body = await client.get<JellyfinQueryResult>('/Items', {
            userId: await this.userId(),
            IncludeItemTypes: 'Playlist',
            MediaTypes: 'Audio',
            Recursive: 'true',
            Fields: 'ChildCount,Overview',
            SortBy: 'SortName',
        });

        const playlists: ProviderPlaylist[] = [];
        for (const item of body.Items ?? []) {
            const mapped = mapPlaylist(item, this.imageUrl(item.Id, item.ImageTags?.Primary));
            if (mapped) playlists.push(mapped);
        }
        playlists.push({ id: EVERYTHING_PLAYLIST_ID, name: EVERYTHING_PLAYLIST_NAME, description: 'Every track in the library.' });

        const offset = options?.offset ?? 0;
        const limit = clampCount(options?.limit);
        return limit === undefined ? playlists.slice(offset) : playlists.slice(offset, offset + limit);
    }

    /**
     * One page of a playlist, paged by the server: Jellyfin's playlist endpoint
     * takes `StartIndex` and `Limit`, so unlike Subsonic nothing has to be held
     * between pages.
     */
    async getPlaylistTracks(playlistId: string, options?: GetPlaylistTracksOptions): Promise<ProviderTrack[]> {
        if (playlistId === EVERYTHING_PLAYLIST_ID) return this.everything(options);
        if (!ITEM_ID.test(playlistId)) throw notAPlaylist(playlistId);

        const client = this.require();
        try {
            const body = await client.get<JellyfinQueryResult>(`/Playlists/${playlistId}/Items`, {
                userId: await this.userId(),
                StartIndex: options?.offset,
                Limit: clampCount(options?.limit),
            });
            return this.toTracks(body.Items);
        } catch (error) {
            if (isMissing(error)) throw notAPlaylist(playlistId);
            throw error;
        }
    }

    /**
     * The whole library, paged.
     *
     * Oldest addition first, so a track added while a walk is in progress lands
     * after every page already read rather than shifting them all by one, which
     * would skip a track at a page boundary. The name breaks ties within one scan.
     */
    private async everything(options?: GetPlaylistTracksOptions): Promise<ProviderTrack[]> {
        const client = this.require();
        const body = await client.get<JellyfinQueryResult>('/Items', {
            ...AUDIO,
            userId: await this.userId(),
            SortBy: 'DateCreated,SortName',
            SortOrder: 'Ascending',
            StartIndex: options?.offset,
            Limit: clampCount(options?.limit) ?? MAX_PAGE_SIZE,
        });
        return this.toTracks(body.Items);
    }

    // --- enrichment ----------------------------------------------------------

    /**
     * Supplementary, the same as the Navidrome plugin: what Jellyfin knows is
     * mostly the files' own tags. MusicBrainz at 100 decides a spelling or a year
     * when both have one; this fills the gaps, and for a record MusicBrainz never
     * heard of it is the only description there is.
     */
    readonly priority = 600;

    /**
     * Artist and title. A `TrackRef`'s MusicBrainz recording id is used when it
     * has one, but only to confirm or rule out candidates found by name, since
     * Jellyfin cannot be asked for an id (see `jellyfin.match.ts`).
     */
    readonly matchKeys: EnrichmentMatchKey[] = ['artist-title'];

    /**
     * What the tags say about a recording: the artist's tracks searched by
     * title, then the whole library by title for a track credited in a way the
     * artist list does not show. `{}` for a track this library does not have,
     * which the host records as a miss on a short clock.
     */
    async enrichTrack(ref: TrackRef): Promise<Partial<TrackEnrichment>> {
        const client = this.require();
        const userId = await this.userId();
        const wanted = { artist: ref.artist, title: ref.title, album: ref.album, mbid: ref.mbid };
        const base: JellyfinParams = { ...AUDIO, userId, Fields: ENRICHMENT_FIELDS };

        const artist = await this.findArtist({ name: ref.artist });
        if (artist?.Id) {
            const theirs = (await client.get<JellyfinQueryResult>('/Items', { ...base, ArtistIds: artist.Id, Limit: MAX_PAGE_SIZE })).Items ?? [];
            const found = selectTrack(theirs, wanted);
            if (found) return mapTrackEnrichment(found, this.trackArt(found));
        }

        const byTitle = (await client.get<JellyfinQueryResult>('/Items', { ...base, searchTerm: ref.title, Limit: MAX_PAGE_SIZE })).Items ?? [];
        const found = selectTrack(byTitle, wanted);
        return found ? mapTrackEnrichment(found, this.trackArt(found)) : {};
    }

    /**
     * What the server says about an artist. `ref.providerRef` is this plugin's
     * own id from last time, so a second pass is a lookup; an id that no longer
     * answers falls back to a search.
     */
    async enrichArtist(ref: ArtistRef): Promise<Partial<ArtistEnrichment>> {
        const known = ref.providerRef ? await this.item(ref.providerRef) : undefined;
        const artist = known?.Type === 'MusicArtist' ? known : await this.findArtist(ref);
        return artist ? mapArtistEnrichment(artist, this.imageUrl(artist.Id, artist.ImageTags?.Primary)) : {};
    }

    /** What the tags say about a record, looked for among its artist's records. Same `providerRef`-first shape. */
    async enrichAlbum(ref: AlbumRef): Promise<Partial<AlbumEnrichment>> {
        const known = ref.providerRef ? await this.item(ref.providerRef) : undefined;
        if (known?.Type === 'MusicAlbum') return mapAlbumEnrichment(known, this.imageUrl(known.Id, known.ImageTags?.Primary));

        const artist = await this.findArtist({ name: ref.artist });
        if (!artist?.Id) return {};
        const client = this.require();
        const records = await client.get<JellyfinQueryResult>('/Items', {
            userId: await this.userId(),
            IncludeItemTypes: 'MusicAlbum',
            Recursive: 'true',
            AlbumArtistIds: artist.Id,
            Fields: ENRICHMENT_FIELDS,
            Limit: MAX_PAGE_SIZE,
        });
        const album = selectAlbum(records.Items ?? [], ref.name, ref.mbid);
        return album ? mapAlbumEnrichment(album, this.imageUrl(album.Id, album.ImageTags?.Primary)) : {};
    }

    /**
     * The artist a name (and id, when known) describes. Asked for by one word of
     * the name, the same probe a search uses, because the artist search compares
     * punctuation literally and a word of the name is enough to find it.
     */
    private async findArtist(ref: { name: string; mbid?: string }): Promise<JellyfinItem | undefined> {
        const probe = artistProbe(`${ref.name} _`) ?? ref.name;
        const client = this.require();
        const body = await client.get<JellyfinQueryResult>('/Artists', {
            userId: await this.userId(),
            searchTerm: probe,
            Fields: ENRICHMENT_FIELDS,
            Limit: ARTIST_PROBE_LIMIT,
            EnableTotalRecordCount: 'false',
        });
        return selectArtist(body.Items ?? [], ref.name, ref.mbid);
    }

    /** One item read with the enrichment fields, or nothing for an id that is malformed or gone. */
    private async item(id: string): Promise<JellyfinItem | undefined> {
        if (!ITEM_ID.test(id)) return undefined;
        const client = this.require();
        const body = await client.get<JellyfinQueryResult>('/Items', { userId: await this.userId(), ids: id, Fields: ENRICHMENT_FIELDS });
        return (body.Items ?? []).find(candidate => candidate.Id?.toLowerCase() === id.toLowerCase());
    }

    /** A track's picture: its own, else its album's. */
    private trackArt(item: JellyfinItem): string | undefined {
        return this.imageUrl(item.Id, item.ImageTags?.Primary) ?? this.imageUrl(item.AlbumId ?? undefined, item.AlbumPrimaryImageTag ?? undefined);
    }

    // --- stream --------------------------------------------------------------

    /**
     * A URL the player can fetch on its own, with the key in its query string.
     *
     * `static=true` is the original file, untouched. A transcode names its
     * container and codec, and its bitrate in bits per second where the setting
     * is in kilobits.
     *
     * The key is sent although 10.11.0 serves this endpoint without one
     * (measured: no key, and a wrong key, both answered 200 with audio). A server
     * that does check, or a release that starts to, must still get a URL that works.
     *
     * No `expiresAt`: an API key does not expire. Not checked against the library
     * first, either: a missing id answers 404, which the host refuses, retries and
     * then benches, so one item is skipped rather than aired as silence.
     */
    async resolveStreamUrl(trackId: string): Promise<ProviderStream | undefined> {
        if (!ITEM_ID.test(trackId)) return undefined;

        const client = this.require();
        const format = this.config?.streamFormat ?? 'raw';
        const bitRate = this.config?.maxBitRate === undefined ? undefined : this.config.maxBitRate * 1000;
        const path = `/Audio/${trackId}/stream`;

        if (format === 'raw') return { url: client.signedUrl(path, { static: 'true' }) };
        const params = format === 'mp3' ? { container: 'mp3', audioCodec: 'mp3' } : { container: 'ogg', audioCodec: 'opus' };
        return { url: client.signedUrl(path, { ...params, audioBitRate: bitRate }), mimeType: MIME_TYPES[format] };
    }

    // --- helpers -------------------------------------------------------------

    protected async onUnload(): Promise<void> {
        this.client = undefined;
        this.config = undefined;
        this.user = undefined;
    }

    /**
     * The configured user's id.
     *
     * `/Users` lists every account, which an API key may read. A failed lookup is
     * not remembered, so a server that was down at the first call is asked again
     * at the next one.
     */
    private userId(): Promise<string> {
        if (this.user) return this.user;

        const client = this.require();
        const username = this.config?.username ?? '';
        const lookup = client.get<JellyfinUser[]>('/Users').then(users => {
            const wanted = normalize(username);
            const user = users.find(candidate => candidate.Id && normalize(candidate.Name ?? '') === wanted);
            if (!user?.Id) throw new PluginError(`Jellyfin has no user called "${username}"`).withCode('config');
            return user.Id;
        });
        this.user = lookup;
        lookup.catch(() => {
            if (this.user === lookup) this.user = undefined;
        });
        return lookup;
    }

    private toTracks(items: JellyfinItem[] | null | undefined): ProviderTrack[] {
        return mapTracks(items, item => this.trackArt(item));
    }

    /**
     * One item's primary image, or nothing when it has none.
     *
     * Carries no credentials, because Jellyfin serves images to anybody, and the
     * image tag makes it stable: the same picture mints the same URL every time,
     * which is what the host's art cache is keyed on. A new picture is a new tag,
     * and so a new URL.
     */
    private imageUrl(itemId: string | undefined, tag: string | undefined): string | undefined {
        if (!itemId || !tag || !this.client) return undefined;
        return this.client.url(`/Items/${itemId}/Images/Primary`, { tag });
    }

    /** The client, or the honest error for being called before `init`. */
    private require(): JellyfinClient {
        if (!this.client) throw new PluginError('Jellyfin plugin used before init()').withCode('config');
        return this.client;
    }
}

/** The answer for an id that names no playlist this server will list. */
const notAPlaylist = (playlistId: string): PluginError => new PluginError(`Jellyfin has no playlist ${playlistId}`).withCode('not_found');
