import type { AlbumEnrichment, ArtistEnrichment, ExternalId, TrackEnrichment } from '@deadair/plugin-sdk';

import { releaseYear, text } from './emby.mapping.js';
import type { EmbyItem } from './emby.types.js';

/**
 * What an Emby server knows about a track, an artist or a record.
 *
 * Mostly the files' own tags, which is why this plugin enriches at all: a
 * bootleg, a self-release or a local band has no description anywhere else.
 *
 * **Emby names each MusicBrainz id for what it is, and keeps one fewer than
 * Jellyfin.** On a file tagged the way MusicBrainz Picard tags one, with both a
 * recording id (`musicbrainz_trackid`) and a release-track id
 * (`musicbrainz_releasetrackid`), Emby 4.10.1 reported `MusicBrainzTrack`
 * holding the RELEASE TRACK id, `MusicBrainzAlbum` (the release),
 * `MusicBrainzReleaseGroup` and `MusicBrainzArtist`, and no recording id at all.
 * So the release-group and artist ids go under the sources the host promotes,
 * the release and release-track ids under names it keeps without promoting, and
 * a track's recording is left for MusicBrainz itself to resolve. A
 * `MusicBrainzRecording` is still read if a server sends one, since that key
 * names nothing else.
 *
 * Pure functions over documents somebody else fetched.
 */

/** Where an Emby item id is filed. Only meaningful on the server it came from. */
export const SOURCE_EMBY = 'emby';

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
export function providerId(item: EmbyItem, key: string): string | undefined {
    const value = text(item.ProviderIds?.[key] ?? undefined);
    return value && UUID.test(value) ? value.toLowerCase() : undefined;
}

/** The genres, trimmed, blanks dropped, each once. */
function genresOf(item: EmbyItem): string[] {
    const names: string[] = [];
    for (const genre of item.Genres ?? []) {
        const name = text(genre);
        if (name && !names.some(seen => seen.toLowerCase() === name.toLowerCase())) names.push(name);
    }
    return names;
}

/** The date part of a `PremiereDate` instant. A date Emby made up for an untagged file would be 0001, which the year rule refuses. */
function releaseDate(item: EmbyItem): string | undefined {
    const match = /^(\d{4})-(\d{2})-(\d{2})T/.exec(item.PremiereDate ?? '');
    return match && releaseYear(Number(match[1])) !== undefined ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

/** An id list with only the entries that have a value. */
function ids(...entries: [string, string | undefined][]): ExternalId[] {
    return entries.flatMap(([source, id]) => (id ? [{ source, id }] : []));
}

/** What the tags say about one recording. */
export function mapTrackEnrichment(item: EmbyItem, artworkUrl?: string): Partial<TrackEnrichment> {
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
        [SOURCE_EMBY, id],
        [SOURCE_MUSICBRAINZ_RECORDING, providerId(item, 'MusicBrainzRecording')],
        [SOURCE_MUSICBRAINZ_TRACK, providerId(item, 'MusicBrainzTrack')],
    );
    return enrichment;
}

/** What the server says about an artist. The biography comes from Emby's online providers when they found one, and is often absent. */
export function mapArtistEnrichment(item: EmbyItem, imageUrl?: string): Partial<ArtistEnrichment> {
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

    enrichment.externalIds = ids([SOURCE_EMBY, id], [SOURCE_MUSICBRAINZ_ARTIST, providerId(item, 'MusicBrainzArtist')]);
    return enrichment;
}

/** What the tags say about a record. */
export function mapAlbumEnrichment(item: EmbyItem, artworkUrl?: string): Partial<AlbumEnrichment> {
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
        [SOURCE_EMBY, id],
        [SOURCE_MUSICBRAINZ_RELEASE_GROUP, providerId(item, 'MusicBrainzReleaseGroup')],
        [SOURCE_MUSICBRAINZ_RELEASE, providerId(item, 'MusicBrainzAlbum')],
    );
    return enrichment;
}
