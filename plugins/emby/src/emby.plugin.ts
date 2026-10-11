import {
    Plugin,
    PluginError,
    errorText,
    normalize,
    type GetPlaylistTracksOptions,
    type ListPlaylistsOptions,
    type MusicProviderPluginInstance,
    type PluginConnectionResult,
    type ProviderPlaylist,
    type ProviderStream,
    type ProviderTrack,
    type SearchTracksOptions,
} from '@deadair/plugin-sdk';

import { EmbyClient, EmbyRequestError, isMissing, type EmbyParams } from './emby.client.js';
import { ITEM_ID, embyPlaylistIdFromUrl, mapPlaylist, mapTracks, text } from './emby.mapping.js';
import {
    ARTIST_PROBE_LIMIT,
    ARTIST_SEARCHES,
    configSchema,
    EVERYTHING_PLAYLIST_ID,
    EVERYTHING_PLAYLIST_NAME,
    MAX_PAGE_SIZE,
    type EmbyConfig,
} from './emby.manifest.js';
import { artistProbe, artistReadings, longestWord, titleMatches, yearsFilter, type ArtistReading } from './emby.search.js';
import type { EmbyItem, EmbyQueryResult, EmbySystemInfo, EmbyUser } from './emby.types.js';

export { embyManifest } from './emby.manifest.js';

/**
 * The fields every track query asks for. Emby leaves a track's year out unless it is named here (measured
 * on 4.10.1: absent without it, 2005 with it), where Jellyfin sends it unasked.
 */
const TRACK_FIELDS = 'ProductionYear';

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
const AUDIO: EmbyParams = { IncludeItemTypes: 'Audio', Recursive: 'true', EnableTotalRecordCount: 'false', Fields: TRACK_FIELDS };

/**
 * Emby as a deadair `music-provider`: an operator's own library on their
 * own media server.
 *
 * The audio path is the ordinary one the SDK was designed around, the same as
 * Navidrome's and Jellyfin's: this plugin mints a URL carrying its own credentials, the player
 * downloads it directly, and no helper process is involved. Nothing here plays
 * audio, so it never declares `steer`.
 *
 * Every request is made as one Emby user, named in the settings. An API key
 * belongs to no user, and the user's library access decides what the station
 * sees.
 */
export class EmbyPlugin extends Plugin implements MusicProviderPluginInstance {
    private client?: EmbyClient;
    private config?: EmbyConfig;
    /** The configured user's id, looked up once per load. A promise, so concurrent first calls share one lookup. */
    private user?: Promise<string>;

    protected async onLoad(): Promise<void> {
        const host = this.host;
        const config = configSchema.parse(await host.config.get()) as EmbyConfig;
        const apiKey = await host.secrets.get('apiKey');
        if (!apiKey) throw new PluginError('Emby API key is not configured').withCode('config');

        this.config = config;
        this.client = new EmbyClient(host, config.baseUrl, apiKey);
        host.logger.info('emby ready', { server: config.baseUrl, user: config.username });
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
            const info = await client.get<EmbySystemInfo>('/System/Info');
            await this.userId();
            const server = [text(info.ProductName) ?? 'Emby Server', text(info.Version)].filter(part => part).join(' ');
            return { ok: true, message: `Connected to ${server} as ${this.config?.username}.` };
        } catch (error) {
            return { ok: false, message: errorText(error) };
        }
    }

    // --- catalog -------------------------------------------------------------

    /**
     * Tracks a free-text query names, read two ways at once.
     *
     * As a title, which is what Emby's search does on its own. And as an
     * artist followed by a title, which is how the station phrases every lookup
     * and which a name-only search cannot match: see `emby.search.ts`. The
     * artist-scoped answers come first, because a track that matched on both
     * the artist and the title is the stronger reading.
     *
     * A period IS applied, through Emby's `Years` filter, so a track whose
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
        const base: EmbyParams = { ...AUDIO, userId, Years: years, Limit: wanted };

        const probe = artistProbe(query);
        const [byTitle, artists] = await Promise.all([
            client.get<EmbyQueryResult>('/Items', { ...base, searchTerm: query }),
            probe === undefined
                ? Promise.resolve<EmbyQueryResult>({})
                : client.get<EmbyQueryResult>('/Artists', {
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
        const merged: EmbyItem[] = [];
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
     * The title is matched HERE rather than by the server, in the SDK's normal
     * form, so a decoration or an accent the server's word match would trip on
     * does not decide it. Emby's own search ignores punctuation (measured on
     * 4.10.1: `mr brightside` found `Mr. Brightside`), but the station's spelling
     * of a title comes from whichever provider it met the record on. An
     * artist with more tracks than one page holds is also searched by the
     * longest word of the title, so a prolific artist's record is not lost past
     * the first page.
     */
    private async artistTracks(client: EmbyClient, base: EmbyParams, reading: ArtistReading): Promise<EmbyItem[]> {
        if (reading.rest === '') return (await client.get<EmbyQueryResult>('/Items', { ...base, ArtistIds: reading.id })).Items ?? [];

        const scoped: EmbyParams = { ...base, ArtistIds: reading.id, SortBy: 'SortName', Limit: MAX_PAGE_SIZE };
        let candidates = (await client.get<EmbyQueryResult>('/Items', scoped)).Items ?? [];
        const word = longestWord(reading.rest);
        if (candidates.length >= MAX_PAGE_SIZE && word !== undefined) {
            candidates = [...candidates, ...((await client.get<EmbyQueryResult>('/Items', { ...scoped, searchTerm: word })).Items ?? [])];
        }
        return titleMatches(candidates, reading.rest);
    }

    /**
     * One track by the id it was stored under.
     *
     * Asked through the `ids` filter rather than `/Items/{id}`, because a filter
     * that matches nothing answers an empty list where the path answers an error
     * that differs between releases. The id is checked first, and the answer is
     * checked to BE that id: measured on 4.10.1, an `ids` value that is not a
     * number fails the whole request, and one that parses as some other kind of
     * id answers with the library's folder instead of nothing.
     */
    async getTrack(trackId: string): Promise<ProviderTrack | undefined> {
        if (!ITEM_ID.test(trackId)) return undefined;

        const client = this.require();
        const body = await client.get<EmbyQueryResult>('/Items', { userId: await this.userId(), ids: trackId, Fields: TRACK_FIELDS });
        const item = (body.Items ?? []).find(candidate => candidate.Id?.toLowerCase() === trackId.toLowerCase());
        return item ? this.toTracks([item])[0] : undefined;
    }

    /** A pasted link into this server's web app, as the item id it names. */
    playlistIdFromUrl(url: string): string | undefined {
        return embyPlaylistIdFromUrl(url, this.config?.baseUrl);
    }

    /**
     * The server's playlists, plus one that is the whole library.
     *
     * Every playlist, not only audio ones, because Emby cannot be asked for those:
     * measured on 4.10.1, adding `MediaTypes=Audio` made it drop the playlist
     * filter and answer with every item in the library, and a playlist carries no
     * media type to filter by afterwards. A video playlist therefore appears and
     * syncs no tracks, which is the honest reading of what the server said.
     *
     * Fetched whole and paged here, so the virtual entry can go last and still be
     * reached by a caller walking pages: an operator's own playlists are what they
     * see first, and the catch-all is where they look when there are none.
     */
    async listPlaylists(options?: ListPlaylistsOptions): Promise<ProviderPlaylist[]> {
        const client = this.require();
        const body = await client.get<EmbyQueryResult>('/Items', {
            userId: await this.userId(),
            IncludeItemTypes: 'Playlist',
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
     * One page of a playlist, paged by the server: Emby's playlist endpoint
     * takes `StartIndex` and `Limit`, so unlike Subsonic nothing has to be held
     * between pages.
     *
     * A playlist that is gone answers 500 rather than 404 (measured on 4.10.1, as
     * does an album's id handed to this endpoint), so a 500 is checked against the
     * item itself before it is called a missing playlist rather than a failing
     * server.
     */
    async getPlaylistTracks(playlistId: string, options?: GetPlaylistTracksOptions): Promise<ProviderTrack[]> {
        if (playlistId === EVERYTHING_PLAYLIST_ID) return this.everything(options);
        if (!ITEM_ID.test(playlistId)) throw notAPlaylist(playlistId);

        const client = this.require();
        try {
            const body = await client.get<EmbyQueryResult>(`/Playlists/${playlistId}/Items`, {
                userId: await this.userId(),
                Fields: TRACK_FIELDS,
                StartIndex: options?.offset,
                Limit: clampCount(options?.limit),
            });
            return this.toTracks(body.Items);
        } catch (error) {
            if (isMissing(error)) throw notAPlaylist(playlistId);
            if (error instanceof EmbyRequestError && error.status === 500 && (await this.lookup(playlistId))?.Type !== 'Playlist')
                throw notAPlaylist(playlistId);
            throw error;
        }
    }

    /** One item by id with no extra fields, or nothing when the server does not hold it. */
    private async lookup(id: string): Promise<EmbyItem | undefined> {
        const client = this.require();
        const body = await client.get<EmbyQueryResult>('/Items', { userId: await this.userId(), ids: id });
        return (body.Items ?? []).find(candidate => candidate.Id === id);
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
        const body = await client.get<EmbyQueryResult>('/Items', {
            ...AUDIO,
            userId: await this.userId(),
            SortBy: 'DateCreated,SortName',
            SortOrder: 'Ascending',
            StartIndex: options?.offset,
            Limit: clampCount(options?.limit) ?? MAX_PAGE_SIZE,
        });
        return this.toTracks(body.Items);
    }

    /** A track's picture: its own, else its album's. */
    private trackArt(item: EmbyItem): string | undefined {
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
     * The key is required: measured on 4.10.1, this endpoint answered 401 without
     * one, which Jellyfin 10.11.0 does not. So this address is a credential.
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
        const lookup = client.get<EmbyUser[]>('/Users').then(users => {
            const wanted = normalize(username);
            const user = users.find(candidate => candidate.Id && normalize(candidate.Name ?? '') === wanted);
            if (!user?.Id) throw new PluginError(`Emby has no user called "${username}"`).withCode('config');
            return user.Id;
        });
        this.user = lookup;
        lookup.catch(() => {
            if (this.user === lookup) this.user = undefined;
        });
        return lookup;
    }

    private toTracks(items: EmbyItem[] | null | undefined): ProviderTrack[] {
        return mapTracks(items, item => this.trackArt(item));
    }

    /**
     * One item's primary image, or nothing when it has none.
     *
     * Carries no credentials, because Emby serves images to anybody, and the
     * image tag makes it stable: the same picture mints the same URL every time,
     * which is what the host's art cache is keyed on. A new picture is a new tag,
     * and so a new URL.
     */
    private imageUrl(itemId: string | undefined, tag: string | undefined): string | undefined {
        if (!itemId || !tag || !this.client) return undefined;
        return this.client.url(`/Items/${itemId}/Images/Primary`, { tag });
    }

    /** The client, or the honest error for being called before `init`. */
    private require(): EmbyClient {
        if (!this.client) throw new PluginError('Emby plugin used before init()').withCode('config');
        return this.client;
    }
}

/** The answer for an id that names no playlist this server will list. */
const notAPlaylist = (playlistId: string): PluginError => new PluginError(`Emby has no playlist ${playlistId}`).withCode('not_found');
