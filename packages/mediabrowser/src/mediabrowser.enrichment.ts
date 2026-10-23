import type { AlbumEnrichment, ArtistEnrichment, ExternalId, TrackEnrichment } from '@deadair/plugin-sdk';

import { releaseYear, text } from './mediabrowser.mapping.js';
import type { MediaBrowserItem } from './mediabrowser.types.js';

/**
 * What a MediaBrowser server knows about a track, an artist or a record.
 *
 * Mostly the files' own tags, which is why these plugins enrich at all: a
 * bootleg, a self-release or a local band has no description anywhere else.
 *
 * **Both servers name each MusicBrainz id for what it is, and the names were
 * checked.** On a file tagged the way MusicBrainz Picard tags one, Jellyfin
 * 10.11.0 reported `MusicBrainzRecording` (Picard's `musicbrainz_trackid`, which
 * holds the recording), `MusicBrainzTrack` (the release track),
 * `MusicBrainzAlbum` (the release) and `MusicBrainzReleaseGroup`, and the
 * recording id is the one MusicBrainz itself returns for that track. Emby 4.10.1
 * keeps one fewer: `MusicBrainzTrack` holding the RELEASE TRACK id, the release,
 * the release group and the artist, and no recording at all. So, unlike Plex's
 * unlabelled GUIDs, the recording, release-group and artist ids go under the
 * sources the host promotes onto its own columns, the release and release-track
 * ids under names it keeps without promoting, and an Emby track's recording is
 * left for MusicBrainz itself to resolve. `MusicBrainzTrack` is never read as a
 * recording on either server, because on both it is not one.
 *
 * Pure functions over documents somebody else fetched.
 */

/** The sources the host promotes: onto `tracks.mbid`, `artists.mbid` and `albums.mbid`. */
export const SOURCE_MUSICBRAINZ_RECORDING = 'musicbrainz';
export const SOURCE_MUSICBRAINZ_ARTIST = 'musicbrainz-artist';
export const SOURCE_MUSICBRAINZ_RELEASE_GROUP = 'musicbrainz-release-group';

/** Kept beside the others and promoted onto nothing, as the MusicBrainz plugin also files them. */
export const SOURCE_MUSICBRAINZ_RELEASE = 'musicbrainz-release';
export const SOURCE_MUSICBRAINZ_TRACK = 'musicbrainz-track';

/** A MusicBrainz id: a UUID, lowercased so two spellings of one id compare equal. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One of an item's provider ids, when it is a well-formed MusicBrainz id. */
export function providerId(item: MediaBrowserItem, key: string): string | undefined {
    const value = text(item.ProviderIds?.[key] ?? undefined);
    return value && UUID.test(value) ? value.toLowerCase() : undefined;
}

/** The genres, trimmed, blanks dropped, each once. */
function genresOf(item: MediaBrowserItem): string[] {
    const names: string[] = [];
    for (const genre of item.Genres ?? []) {
        const name = text(genre);
        if (name && !names.some(seen => seen.toLowerCase() === name.toLowerCase())) names.push(name);
    }
    return names;
}

/** The date part of a `PremiereDate` instant. A date the server made up for an untagged file would be 0001, which the year rule refuses. */
function releaseDate(item: MediaBrowserItem): string | undefined {
    const match = /^(\d{4})-(\d{2})-(\d{2})T/.exec(item.PremiereDate ?? '');
    return match && releaseYear(Number(match[1])) !== undefined ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

/** An id list with only the entries that have a value. */
function ids(...entries: [string, string | undefined][]): ExternalId[] {
    return entries.flatMap(([source, id]) => (id ? [{ source, id }] : []));
}

/** What the tags say about one recording. `source` is the server's own name, which its item id is filed under. */
export function mapTrackEnrichment(item: MediaBrowserItem, source: string, artworkUrl?: string): Partial<TrackEnrichment> {
    const enrichment: Partial<TrackEnrichment> = {};
    const id = text(item.Id);
    if (!id) return enrichment;
    enrichment.providerRef = id;

    const title = text(item.Name);
    if (title) enrichment.title = title;
    const artist = text(item.Artists?.[0]) ?? text(item.AlbumArtist);
    if (artist) enrichment.artist = artist;
    const album = text(item.Album);
    if (album) enrichment.album = album;
    const year = releaseYear(item.ProductionYear);
    if (year !== undefined) enrichment.year = year;
    const date = releaseDate(item);
    if (date) enrichment.releaseDate = date;
    const genres = genresOf(item);
    if (genres.length > 0) enrichment.genres = genres;
    if (artworkUrl) enrichment.artworkUrl = artworkUrl;

    enrichment.externalIds = ids(
        [source, id],
        [SOURCE_MUSICBRAINZ_RECORDING, providerId(item, 'MusicBrainzRecording')],
        [SOURCE_MUSICBRAINZ_TRACK, providerId(item, 'MusicBrainzTrack')],
    );
    return enrichment;
}

/**
 * What the server says about an artist. The biography comes from the server's online providers when they
 * found one, and is often absent.
 */
export function mapArtistEnrichment(item: MediaBrowserItem, source: string, imageUrl?: string): Partial<ArtistEnrichment> {
    const enrichment: Partial<ArtistEnrichment> = {};
    const id = text(item.Id);
    if (!id) return enrichment;
    enrichment.providerRef = id;

    const name = text(item.Name);
    if (name) enrichment.name = name;
    const biography = text(item.Overview);
    if (biography) enrichment.biography = biography;
    const genres = genresOf(item);
    if (genres.length > 0) enrichment.genres = genres;
    if (imageUrl) enrichment.imageUrl = imageUrl;

    enrichment.externalIds = ids([source, id], [SOURCE_MUSICBRAINZ_ARTIST, providerId(item, 'MusicBrainzArtist')]);
    return enrichment;
}

/** What the tags say about a record. */
export function mapAlbumEnrichment(item: MediaBrowserItem, source: string, artworkUrl?: string): Partial<AlbumEnrichment> {
    const enrichment: Partial<AlbumEnrichment> = {};
    const id = text(item.Id);
    if (!id) return enrichment;
    enrichment.providerRef = id;

    const name = text(item.Name);
    if (name) enrichment.name = name;
    const artist = text(item.AlbumArtist);
    if (artist) enrichment.artist = artist;
    const year = releaseYear(item.ProductionYear);
    if (year !== undefined) enrichment.year = year;
    const date = releaseDate(item);
    if (date) enrichment.releaseDate = date;
    const label = text(item.Studios?.[0]?.Name ?? undefined);
    if (label) enrichment.label = label;
    const genres = genresOf(item);
    if (genres.length > 0) enrichment.genres = genres;
    if (artworkUrl) enrichment.artworkUrl = artworkUrl;

    enrichment.externalIds = ids(
        [source, id],
        [SOURCE_MUSICBRAINZ_RELEASE_GROUP, providerId(item, 'MusicBrainzReleaseGroup')],
        [SOURCE_MUSICBRAINZ_RELEASE, providerId(item, 'MusicBrainzAlbum')],
    );
    return enrichment;
}
