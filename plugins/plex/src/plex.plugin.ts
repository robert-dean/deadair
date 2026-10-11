import {
    Plugin,
    PluginError,
    baseForm,
    errorText,
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

import { PlexClient, isMissing } from './plex.client.js';
import { mapAlbumEnrichment, mapArtistEnrichment, mapTrackEnrichment, musicBrainzId } from './plex.enrichment.js';
import { RATING_KEY, mapPlaylist, mapTracks, partKey, plexPlaylistIdFromUrl, text, trackYear } from './plex.mapping.js';
import {
    ARTIST_PROBE_LIMIT,
    ARTIST_SEARCHES,
    configSchema,
    EVERYTHING_PREFIX,
    MAX_PAGE_SIZE,
    SECTIONS_TTL_MS,
    type PlexConfig,
} from './plex.manifest.js';
import { selectAlbum, selectArtist, selectTrack } from './plex.match.js';
import { artistProbe, artistReadings, inPeriod, titleMatches, type ArtistReading } from './plex.search.js';
import type { PlexDirectory, PlexMetadata } from './plex.types.js';

export { plexManifest } from './plex.manifest.js';

/** How many tracks a search answers when the caller did not say. */
const DEFAULT_SEARCH_LIMIT = 50;

/** Plex's item type numbers, as its filters take them. */
const TYPE_ARTIST = 8;
const TYPE_ALBUM = 9;
const TYPE_TRACK = 10;

/** Candidates an enrichment lookup reads before deciding which, if any, is the one asked about. */
const ENRICHMENT_CANDIDATES = 20;

/** A caller's requested page size, kept inside {@link MAX_PAGE_SIZE}. `undefined` means the caller did not say. */
const clampCount = (limit: number | undefined): number | undefined => {
    if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return undefined;
    return Math.min(Math.floor(limit), MAX_PAGE_SIZE);
};

/** Plex's paging parameters. It reads them from the query string as well as from headers. */
const page = (offset: number | undefined, size: number | undefined) => ({
    'X-Plex-Container-Start': offset,
    'X-Plex-Container-Size': size,
});

/** A music library on the server. */
interface Section {
    key: string;
    title: string;
}

/**
 * Plex as a deadair `music-provider`: the music libraries on an operator's own
 * Plex Media Server, read with their token.
 *
 * The audio path is the ordinary one: the station is handed the address of the
 * original file with the token in its query string, and fetches it directly.
 * Unlike Subsonic or Jellyfin, a track's id is not enough to build that
 * address, because Plex serves a file at the path of its media PART: so
 * resolving a stream reads the track once to learn the path.
 *
 * Nothing here plays audio, so it never declares `steer`.
 */
export class PlexPlugin extends Plugin implements MusicProviderPluginInstance, EnrichmentProvider {
    private client?: PlexClient;
    /** The music libraries, read once and trusted for {@link SECTIONS_TTL_MS}. A promise, so concurrent first calls share one read. */
    private sections?: { list: Promise<Section[]>; at: number };
    /** The server's machine id, which a pasted Plex Web link must name to be ours. Learnt from the first call that sees it. */
    private machineIdentifier?: string;

    protected async onLoad(): Promise<void> {
        const host = this.host;
        const config = configSchema.parse(await host.config.get()) as PlexConfig;
        const token = await host.secrets.get('token');
        if (!token) throw new PluginError('Plex token is not configured').withCode('config');

        this.client = new PlexClient(host, config.baseUrl, token);
        host.logger.info('plex ready', { server: config.baseUrl });
    }

    /**
     * Proves the URL and the token together, and that the token can see some
     * music: a server whose token reaches no music library is connected and
     * useless, which is worth saying in so many words.
     */
    async testConnection(): Promise<PluginConnectionResult> {
        try {
            const client = this.require();
            const root = await client.get('/');
            this.machineIdentifier = text(root.machineIdentifier) ?? this.machineIdentifier;
            const sections = await this.musicSections(true);
            const server = [text(root.friendlyName), text(root.version)].filter(part => part).join(' ');
            if (sections.length === 0) return { ok: false, message: `Connected to ${server || 'Plex'}, but this token can see no music library.` };
            const libraries = sections.map(section => section.title).join(', ');
            return { ok: true, message: `Connected to ${server || 'Plex'}. Music: ${libraries}.` };
        } catch (error) {
            return { ok: false, message: errorText(error) };
        }
    }

    // --- catalog -------------------------------------------------------------

    /**
     * Tracks a free-text query names, read as a title and as an artist followed
     * by a title (see `plex.search.ts`), across every music library, artist
     * matches first.
     *
     * A period is applied here, to the year on each candidate, so a track whose
     * year Plex does not know is left out of a period search. That is the filter
     * honoured as written rather than widened: answering with undated tracks
     * would hand the station records nothing marks as outside the period.
     */
    async searchTracks(query: string, options?: SearchTracksOptions): Promise<ProviderTrack[]> {
        const client = this.require();
        const offset = Math.max(Math.floor(options?.offset ?? 0), 0);
        const wanted = Math.min(offset + (clampCount(options?.limit) ?? DEFAULT_SEARCH_LIMIT), MAX_PAGE_SIZE);
        const filtered = options?.yearFrom !== undefined || options?.yearTo !== undefined;
        // A period is applied after fetching, so ask for a full page to have something left after it.
        const size = filtered ? MAX_PAGE_SIZE : wanted;
        const probe = artistProbe(query);

        const perSection = await Promise.all(
            (await this.musicSections()).map(async section => {
                const [byTitle, artists] = await Promise.all([
                    client.get(`/library/sections/${section.key}/all`, { type: TYPE_TRACK, title: query, ...page(0, size) }),
                    probe === undefined
                        ? Promise.resolve(undefined)
                        : client.get(`/library/sections/${section.key}/all`, { type: TYPE_ARTIST, title: probe, ...page(0, ARTIST_PROBE_LIMIT) }),
                ]);
                const readings = artistReadings(
                    query,
                    (artists?.Metadata ?? []).flatMap(artist =>
                        artist.ratingKey && text(artist.title) ? [{ id: artist.ratingKey, name: text(artist.title)! }] : [],
                    ),
                ).slice(0, ARTIST_SEARCHES);
                const byArtist = await Promise.all(readings.map(reading => this.artistTracks(client, section, reading, size)));
                return { byArtist: byArtist.flat(), byTitle: byTitle.Metadata ?? [] };
            }),
        );

        const seen = new Set<string>();
        const merged: PlexMetadata[] = [];
        for (const item of [...perSection.flatMap(found => found.byArtist), ...perSection.flatMap(found => found.byTitle)]) {
            if (!item.ratingKey || seen.has(item.ratingKey)) continue;
            if (!inPeriod(trackYear(item), options?.yearFrom, options?.yearTo)) continue;
            seen.add(item.ratingKey);
            merged.push(item);
        }

        return this.toTracks(merged).slice(offset, wanted);
    }

    /**
     * One artist's tracks whose title is the rest of the query, compared here in
     * normal form. An artist with more tracks than one page holds is also searched
     * by title across the library, kept to tracks credited to them, so a prolific
     * artist's record is not lost past the first page.
     */
    private async artistTracks(client: PlexClient, section: Section, reading: ArtistReading, size: number): Promise<PlexMetadata[]> {
        const leaves =
            (await client.get(`/library/metadata/${reading.id}/allLeaves`, page(0, reading.rest === '' ? size : MAX_PAGE_SIZE))).Metadata ?? [];
        if (reading.rest === '') return leaves;

        let candidates = leaves;
        if (leaves.length >= MAX_PAGE_SIZE) {
            const artist = leaves[0]?.grandparentTitle;
            const more =
                (await client.get(`/library/sections/${section.key}/all`, { type: TYPE_TRACK, title: reading.rest, ...page(0, MAX_PAGE_SIZE) }))
                    .Metadata ?? [];
            candidates = [...leaves, ...more.filter(item => item.grandparentTitle === artist)];
        }
        return titleMatches(candidates, reading.rest);
    }

    /** One track by its rating key. A key the server no longer holds is an answer, not a failure. */
    async getTrack(trackId: string): Promise<ProviderTrack | undefined> {
        const item = await this.track(trackId);
        return item ? this.toTracks([item])[0] : undefined;
    }

    /** A pasted Plex Web link, as the playlist it names, when it names one on this server. */
    playlistIdFromUrl(url: string): string | undefined {
        return plexPlaylistIdFromUrl(url, this.machineIdentifier);
    }

    /**
     * The account's audio playlists, smart ones included, then one Everything
     * playlist per music library.
     *
     * Fetched whole and paged here, so the virtual entries go last and are still
     * reached by a caller walking pages.
     */
    async listPlaylists(options?: ListPlaylistsOptions): Promise<ProviderPlaylist[]> {
        const client = this.require();
        const [body, sections] = await Promise.all([client.get('/playlists', { playlistType: 'audio' }), this.musicSections(), this.learnIdentity()]);

        const playlists: ProviderPlaylist[] = [];
        for (const item of body.Metadata ?? []) {
            const mapped = mapPlaylist(item, this.imageUrl(item.composite ?? item.thumb));
            if (mapped) playlists.push(mapped);
        }
        for (const section of sections) {
            playlists.push({
                id: `${EVERYTHING_PREFIX}${section.key}`,
                name: sections.length === 1 ? 'Everything' : `Everything in ${section.title}`,
                description: `Every track in the ${section.title} library.`,
            });
        }

        const offset = options?.offset ?? 0;
        const limit = clampCount(options?.limit);
        return limit === undefined ? playlists.slice(offset) : playlists.slice(offset, offset + limit);
    }

    /** One page of a playlist, or of a whole library, paged by the server. */
    async getPlaylistTracks(playlistId: string, options?: GetPlaylistTracksOptions): Promise<ProviderTrack[]> {
        const client = this.require();
        const size = clampCount(options?.limit) ?? MAX_PAGE_SIZE;

        if (playlistId.startsWith(EVERYTHING_PREFIX)) {
            const sectionKey = playlistId.slice(EVERYTHING_PREFIX.length);
            if (!RATING_KEY.test(sectionKey)) throw notAPlaylist(playlistId);
            // Oldest addition first, so a track added during a walk lands after every page already
            // read rather than shifting them all by one. `addedAt` is in whole seconds, so a whole scan
            // ties on it (measured on 1.43.4), and the id, which is unique, breaks the tie.
            return this.toTracks(
                (
                    await this.orNotFound(playlistId, () =>
                        client.get(`/library/sections/${sectionKey}/all`, {
                            type: TYPE_TRACK,
                            sort: 'addedAt,id',
                            ...page(options?.offset ?? 0, size),
                        }),
                    )
                ).Metadata,
            );
        }

        if (!RATING_KEY.test(playlistId)) throw notAPlaylist(playlistId);
        return this.toTracks(
            (await this.orNotFound(playlistId, () => client.get(`/playlists/${playlistId}/items`, page(options?.offset ?? 0, size)))).Metadata,
        );
    }

    // --- enrichment ----------------------------------------------------------

    /**
     * Supplementary, not canonical. MusicBrainz at 100 decides a spelling or a
     * year when both have one. Plex's agents are a curated source rather than a
     * guess, which is why this sits at the SDK's supplementary 500 rather than
     * with the file-tag sources after it.
     */
    readonly priority = 500;

    /**
     * Plex exposes no ISRC, and the MusicBrainz id a `TrackRef` may carry is a
     * RECORDING id where Plex holds TRACK ids (see `plex.enrichment.ts`), so the
     * two never meet: artist-and-title is the only key there is.
     */
    readonly matchKeys: EnrichmentMatchKey[] = ['artist-title'];

    /**
     * What the server knows about a recording, for a track found by artist and
     * title and then read whole for the fields a listing leaves out.
     *
     * `{}` for a track this library does not have, which the host records as a
     * miss on a short clock. No `enrichTracks`: Plex has no bulk lookup by name,
     * so a batch would only be the same searches under one deadline.
     */
    async enrichTrack(ref: TrackRef): Promise<Partial<TrackEnrichment>> {
        const found = await this.findTrack(ref);
        const item = found?.ratingKey ? await this.metadata(found.ratingKey) : undefined;
        return item?.type === 'track' ? mapTrackEnrichment(item, this.imageUrl(item.parentThumb ?? item.thumb)) : {};
    }

    /**
     * What the server knows about an artist. `ref.providerRef` is this plugin's
     * rating key from last time, so a second pass is a lookup; a key that no
     * longer answers (Plex removed and re-added the artist) falls back to a search
     * by id and name rather than giving up, which is how a renumbered library
     * heals.
     */
    async enrichArtist(ref: ArtistRef): Promise<Partial<ArtistEnrichment>> {
        const known = ref.providerRef ? await this.metadata(ref.providerRef) : undefined;
        const item = known?.type === 'artist' ? known : await this.findArtist(ref);
        return item ? mapArtistEnrichment(item, this.imageUrl(item.thumb)) : {};
    }

    /** What the server knows about a record. Same `providerRef`-first shape, the same fallback. */
    async enrichAlbum(ref: AlbumRef): Promise<Partial<AlbumEnrichment>> {
        const known = ref.providerRef ? await this.metadata(ref.providerRef) : undefined;
        const item = known?.type === 'album' ? known : await this.findAlbum(ref);
        return item ? mapAlbumEnrichment(item, this.imageUrl(item.thumb)) : {};
    }

    /**
     * The track that is the one asked about, if this library has it. Searched by
     * title in every music library, then by the title without its decorations if
     * that found nothing convincing: a catalog's "Roads (2011 Remaster)" is a
     * library's "Roads".
     */
    private async findTrack(ref: TrackRef): Promise<PlexMetadata | undefined> {
        const titles = [...new Set([ref.title, baseForm(ref.title)].filter(title => title.trim().length > 0))];
        for (const title of titles) {
            const candidates = await this.inSections(TYPE_TRACK, title);
            const found = selectTrack(candidates, { artist: ref.artist, title: ref.title, album: ref.album });
            if (found) return found;
        }
        return undefined;
    }

    /** The artist the ref names, by MusicBrainz id when it carries one and by an unambiguous name otherwise. */
    private async findArtist(ref: ArtistRef): Promise<PlexMetadata | undefined> {
        const found = selectArtist(await this.inSections(TYPE_ARTIST, ref.name), ref.name, ref.mbid, musicBrainzId);
        return found?.ratingKey ? await this.metadata(found.ratingKey) : undefined;
    }

    /** The record the ref names, matched on title and artist so a same-named record by somebody else is not it. */
    private async findAlbum(ref: AlbumRef): Promise<PlexMetadata | undefined> {
        const found = selectAlbum(await this.inSections(TYPE_ALBUM, ref.name), ref.name, ref.artist);
        return found?.ratingKey ? await this.metadata(found.ratingKey) : undefined;
    }

    /** Items of one type whose title matches, from every music library, with their GUIDs. */
    private async inSections(type: number, title: string): Promise<PlexMetadata[]> {
        const client = this.require();
        const answers = await Promise.all(
            (await this.musicSections()).map(section =>
                client.get(`/library/sections/${section.key}/all`, { type, title, includeGuids: 1, ...page(0, ENRICHMENT_CANDIDATES) }),
            ),
        );
        return answers.flatMap(answer => answer.Metadata ?? []);
    }

    /**
     * One item read whole, GUIDs included, or nothing for a key that is malformed
     * or gone. A listing leaves out the label, the moods and the biography, which
     * are most of what enrichment is for.
     */
    private async metadata(ratingKey: string): Promise<PlexMetadata | undefined> {
        if (!RATING_KEY.test(ratingKey)) return undefined;

        const client = this.require();
        try {
            return (await client.get(`/library/metadata/${ratingKey}`, { includeGuids: 1 })).Metadata?.[0];
        } catch (error) {
            if (isMissing(error)) return undefined;
            throw error;
        }
    }

    // --- stream --------------------------------------------------------------

    /**
     * The original file, at the path of the track's media part, with the token
     * in its query string.
     *
     * One read of the track per resolve, because the part's path is not
     * derivable from the track's id. No transcoding: Plex transcodes through a
     * session-based universal endpoint built for its own players, and the
     * station's decoder reads every format a music library normally holds.
     *
     * No `expiresAt`: a Plex token lasts until it is signed out.
     */
    async resolveStreamUrl(trackId: string): Promise<ProviderStream | undefined> {
        const item = await this.track(trackId);
        const key = item ? partKey(item) : undefined;
        return key === undefined ? undefined : { url: this.require().signedUrl(key) };
    }

    // --- helpers -------------------------------------------------------------

    protected async onUnload(): Promise<void> {
        this.client = undefined;
        this.sections = undefined;
        this.machineIdentifier = undefined;
    }

    /**
     * The server's machine id, read once from `/identity` so a pasted link can be
     * checked against it. Read here because `/playlists` does not carry it, and a
     * playlist walk is what every sync starts with. A failure costs only the link
     * import, so it is swallowed and tried again next time.
     */
    private async learnIdentity(): Promise<void> {
        if (this.machineIdentifier !== undefined) return;
        try {
            this.machineIdentifier = text((await this.require().get('/identity')).machineIdentifier);
        } catch {
            // Tried again on the next walk.
        }
    }

    /** One track's full metadata, or nothing for a key that is malformed, gone, or not a track. */
    private async track(trackId: string): Promise<PlexMetadata | undefined> {
        const item = await this.metadata(trackId);
        return item?.type === 'track' ? item : undefined;
    }

    /**
     * The server's music libraries: sections of type `artist`, which is what
     * Plex calls a music library. A failed read is not remembered.
     */
    private musicSections(fresh = false): Promise<Section[]> {
        const now = Date.now();
        if (!fresh && this.sections && now - this.sections.at < SECTIONS_TTL_MS) return this.sections.list;

        const client = this.require();
        const list = client
            .get('/library/sections')
            .then(body =>
                (body.Directory ?? []).flatMap((directory: PlexDirectory) =>
                    directory.type === 'artist' && directory.key ? [{ key: directory.key, title: text(directory.title) ?? 'Music' }] : [],
                ),
            );
        const entry = { list, at: now };
        this.sections = entry;
        list.catch(() => {
            if (this.sections === entry) this.sections = undefined;
        });
        return list;
    }

    /** A playlist or library fetch, with Plex's 404 turned into the SDK's not_found. */
    private async orNotFound<T>(playlistId: string, fetch: () => Promise<T>): Promise<T> {
        try {
            return await fetch();
        } catch (error) {
            if (isMissing(error)) throw notAPlaylist(playlistId);
            throw error;
        }
    }

    private toTracks(items: PlexMetadata[] | undefined): ProviderTrack[] {
        return mapTracks(items, item => this.imageUrl(item.thumb ?? item.parentThumb ?? item.grandparentThumb));
    }

    /**
     * A picture on the server, with the token, since Plex serves images only to
     * a caller it knows. Stable: Plex ends every image path with a version
     * stamp, so the same picture mints the same URL and a new one a new URL,
     * which is what the host's art cache is keyed on.
     */
    private imageUrl(path: string | undefined): string | undefined {
        const trimmed = text(path);
        if (!trimmed || !trimmed.startsWith('/') || !this.client) return undefined;
        return this.client.signedUrl(trimmed);
    }

    /** The client, or the honest error for being called before `init`. */
    private require(): PlexClient {
        if (!this.client) throw new PluginError('Plex plugin used before init()').withCode('config');
        return this.client;
    }
}

/** The answer for an id that names no playlist or library this server will list. */
const notAPlaylist = (playlistId: string): PluginError => new PluginError(`Plex has no playlist ${playlistId}`).withCode('not_found');
