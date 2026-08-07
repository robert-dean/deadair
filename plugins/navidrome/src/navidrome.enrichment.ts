import type { AlbumEnrichment, ArtistEnrichment, ExternalId, TrackEnrichment } from '@deadair/plugin-sdk';

import { genreNames, text } from './navidrome.mapping.js';
import type { SubsonicAlbum, SubsonicArtist, SubsonicArtistInfo, SubsonicChild } from './navidrome.types.js';

/**
 * What a library's own tags are worth saying about a track, an artist or a
 * record.
 *
 * The reason this plugin enriches at all: the operator's files carry metadata no
 * external service has. A bootleg, a self-release, a local band, a compilation
 * somebody tagged by hand — MusicBrainz will never have heard of them, and the
 * tags are the only description that exists.
 *
 * Everything here is a rearrangement of a document somebody else fetched, so it
 * is testable with no host at all.
 */

/** Where a Navidrome id is filed, so the host can tell one source's ids from another's. */
export const SOURCE_NAVIDROME = 'navidrome';

/** MusicBrainz's, for ids read out of file tags. Matches what the host promotes by. */
export const SOURCE_MUSICBRAINZ_RECORDING = 'musicbrainz';
export const SOURCE_MUSICBRAINZ_ARTIST = 'musicbrainz-artist';
export const SOURCE_MUSICBRAINZ_RELEASE_GROUP = 'musicbrainz-release-group';

/**
 * An OpenSubsonic date as an ISO-8601 string, or nothing.
 *
 * Partial dates are legal and common: a record tagged with only a year is
 * `1994`, not `1994-01-01`. Inventing the missing parts would be a claim the
 * tags never made.
 */
export function releaseDate(date: { year?: number; month?: number; day?: number } | undefined): string | undefined {
    if (!date?.year) return undefined;

    const pad = (value: number): string => String(value).padStart(2, '0');
    if (!date.month) return String(date.year);
    if (!date.day) return `${date.year}-${pad(date.month)}`;
    return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

/** A positive four-digit-ish year, or nothing. Subsonic sends `0` for "untagged". */
const year = (value: number | undefined): number | undefined => (typeof value === 'number' && value > 0 ? value : undefined);

/**
 * What the file's tags say about one recording.
 *
 * `providerRef` is the song id and `externalIds` carries whatever the tags hold,
 * including a MusicBrainz id — which is exactly the case the host's ref used to
 * get wrong when it inferred the ref from the first entry in that list.
 */
export function mapTrackEnrichment(song: SubsonicChild): Partial<TrackEnrichment> {
    const enrichment: Partial<TrackEnrichment> = {};
    if (!song.id) return enrichment;

    enrichment.providerRef = song.id;

    const title = text(song.title);
    if (title) enrichment.title = title;
    const artist = text(song.artist);
    if (artist) enrichment.artist = artist;
    const album = text(song.album);
    if (album) enrichment.album = album;

    const tagged = year(song.year);
    if (tagged !== undefined) enrichment.year = tagged;

    const genres = genreNames(song);
    if (genres.length > 0) enrichment.genres = genres;

    const externalIds: ExternalId[] = [{ source: SOURCE_NAVIDROME, id: song.id }];
    const mbid = text(song.musicBrainzId);
    if (mbid) externalIds.push({ source: SOURCE_MUSICBRAINZ_RECORDING, id: mbid });
    enrichment.externalIds = externalIds;

    return enrichment;
}

/**
 * What the server can say about an artist.
 *
 * The biography and the image come from Navidrome's own metadata agents rather
 * than from the files, so both are frequently absent and that is not a failure —
 * an empty answer is a miss, which the host records on a short clock and asks
 * about again later.
 */
export function mapArtistEnrichment(artist: SubsonicArtist | undefined, info: SubsonicArtistInfo | undefined): Partial<ArtistEnrichment> {
    const enrichment: Partial<ArtistEnrichment> = {};

    const id = text(artist?.id);
    if (id) enrichment.providerRef = id;

    const name = text(artist?.name);
    if (name) enrichment.name = name;

    const biography = text(info?.biography);
    if (biography) enrichment.biography = biography;

    // The largest of the three, because this ends up next to a track on a screen
    // rather than in a list of thumbnails.
    const image = text(info?.largeImageUrl) ?? text(info?.mediumImageUrl) ?? text(info?.smallImageUrl);
    if (image) enrichment.imageUrl = image;

    const externalIds: ExternalId[] = [];
    if (id) externalIds.push({ source: SOURCE_NAVIDROME, id });
    const mbid = text(info?.musicBrainzId) ?? text(artist?.musicBrainzId);
    if (mbid) externalIds.push({ source: SOURCE_MUSICBRAINZ_ARTIST, id: mbid });
    if (externalIds.length > 0) enrichment.externalIds = externalIds;

    const lastFm = text(info?.lastFmUrl);
    if (lastFm) enrichment.links = [{ label: 'Last.fm', url: lastFm }];

    return enrichment;
}

/** What the tags say about a record. */
export function mapAlbumEnrichment(album: SubsonicAlbum | undefined, artworkUrl?: string): Partial<AlbumEnrichment> {
    const enrichment: Partial<AlbumEnrichment> = {};
    if (!album) return enrichment;

    const id = text(album.id);
    if (id) enrichment.providerRef = id;

    const name = text(album.name);
    if (name) enrichment.name = name;
    const artist = text(album.artist);
    if (artist) enrichment.artist = artist;

    const tagged = year(album.year);
    if (tagged !== undefined) enrichment.year = tagged;

    const date = releaseDate(album.originalReleaseDate);
    if (date) enrichment.releaseDate = date;

    const genres = genreNames(album);
    if (genres.length > 0) enrichment.genres = genres;

    if (artworkUrl) enrichment.artworkUrl = artworkUrl;

    const externalIds: ExternalId[] = [];
    if (id) externalIds.push({ source: SOURCE_NAVIDROME, id });
    const mbid = text(album.musicBrainzId);
    if (mbid) externalIds.push({ source: SOURCE_MUSICBRAINZ_RELEASE_GROUP, id: mbid });
    if (externalIds.length > 0) enrichment.externalIds = externalIds;

    return enrichment;
}
