import type { AlbumEnrichment, ArtistEnrichment, ExternalId, TrackEnrichment } from '@deadair/plugin-sdk';

import { text, trackYear } from './plex.mapping.js';
import type { PlexMetadata, PlexTag } from './plex.types.js';

/**
 * What a Plex server knows about a track, an artist or a record.
 *
 * Plex's metadata agents fill a music library with more than its files carry: a
 * label, styles narrower than a genre, an artist's biography, and MusicBrainz ids
 * for nearly everything (193 of 200 tracks, 197 of 200 albums and every artist,
 * sampled on the server this was built against).
 *
 * **The MusicBrainz ids are not all the kinds their position suggests, and that
 * was checked rather than assumed.** Asked of MusicBrainz itself: an artist's id
 * is an artist id, but an album's is a RELEASE (the pressing) where the host's
 * album column holds a release GROUP, and a track's is a TRACK id (the recording
 * as it appears on that release) where the host's track column holds a
 * RECORDING. `/ws/2/recording/<id>` answered 404 for every track id tried, and a
 * `tid:` search found each one. So only the artist id is filed under the source
 * the host promotes; the other two are filed under their own names, kept beside
 * the others and promoted onto nothing. Filed under `musicbrainz`, a track id
 * would be written into `tracks.mbid` as a recording it is not.
 *
 * Pure functions over documents somebody else fetched.
 */

/** Where a Plex rating key is filed. Only meaningful on the server it came from. */
export const SOURCE_PLEX = 'plex';

/** Plex's own id (`plex://track/…`), which survives a rescan that changes the rating key. */
export const SOURCE_PLEX_GUID = 'plex-guid';

/** Promoted by the host onto `artists.mbid`. */
export const SOURCE_MUSICBRAINZ_ARTIST = 'musicbrainz-artist';

/** A MusicBrainz track id. No host column holds one, so it is kept and never promoted. */
export const SOURCE_MUSICBRAINZ_TRACK = 'musicbrainz-track';

/** A MusicBrainz release id, as the MusicBrainz plugin also files one. Not the release group the host promotes. */
export const SOURCE_MUSICBRAINZ_RELEASE = 'musicbrainz-release';

/** The MusicBrainz id among an item's GUIDs, which Plex writes as `mbid://<uuid>`. */
export function musicBrainzId(item: PlexMetadata): string | undefined {
    for (const guid of item.Guid ?? []) {
        const match = /^mbid:\/\/([0-9a-f-]{36})$/i.exec(guid.id ?? '');
        if (match) return match[1]!.toLowerCase();
    }
    return undefined;
}

/** The names in a tag list, trimmed, blanks dropped, duplicates kept once. */
const tags = (...lists: (PlexTag[] | undefined)[]): string[] => {
    const names: string[] = [];
    for (const entry of lists.flatMap(list => list ?? [])) {
        const name = text(entry.tag);
        if (name && !names.some(seen => seen.toLowerCase() === name.toLowerCase())) names.push(name);
    }
    return names;
};

/** A `YYYY-MM-DD` release date, or nothing. Anything else Plex sends is not a date this can vouch for. */
const releaseDate = (value: string | undefined): string | undefined => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined);

/** The ids every item carries: its rating key, and Plex's own id when it has one. */
function plexIds(item: PlexMetadata): ExternalId[] {
    const ids: ExternalId[] = [];
    const key = text(item.ratingKey);
    if (key) ids.push({ source: SOURCE_PLEX, id: key });
    const guid = text(item.guid);
    if (guid?.startsWith('plex://')) ids.push({ source: SOURCE_PLEX_GUID, id: guid });
    return ids;
}

/**
 * What the server says about one track. Styles narrower than a genre are an
 * album's and an artist's in Plex, never a track's, so a track's genres are its
 * own broad ones.
 */
export function mapTrackEnrichment(item: PlexMetadata, artworkUrl?: string): Partial<TrackEnrichment> {
    const enrichment: Partial<TrackEnrichment> = {};
    const key = text(item.ratingKey);
    if (!key) return enrichment;
    enrichment.providerRef = key;

    const title = text(item.title);
    if (title) enrichment.title = title;
    const artist = text(item.originalTitle) ?? text(item.grandparentTitle);
    if (artist) enrichment.artist = artist;
    const album = text(item.parentTitle);
    if (album) enrichment.album = album;
    const year = trackYear(item);
    if (year !== undefined) enrichment.year = year;
    const genres = tags(item.Genre);
    if (genres.length > 0) enrichment.genres = genres;
    const moods = tags(item.Mood);
    if (moods.length > 0) enrichment.moods = moods;
    const label = text(item.parentStudio);
    if (label) enrichment.label = label;
    if (artworkUrl) enrichment.artworkUrl = artworkUrl;

    const ids = plexIds(item);
    const mbid = musicBrainzId(item);
    if (mbid) ids.push({ source: SOURCE_MUSICBRAINZ_TRACK, id: mbid });
    enrichment.externalIds = ids;
    return enrichment;
}

/** What the server says about an artist: the biography, the styles they play, a picture. */
export function mapArtistEnrichment(item: PlexMetadata, imageUrl?: string): Partial<ArtistEnrichment> {
    const enrichment: Partial<ArtistEnrichment> = {};
    const key = text(item.ratingKey);
    if (!key) return enrichment;
    enrichment.providerRef = key;

    const name = text(item.title);
    if (name) enrichment.name = name;
    const biography = text(item.summary);
    if (biography) enrichment.biography = biography;
    // Styles first: "Power Metal" says more about a band than "Pop/Rock" does.
    const genres = tags(item.Style, item.Genre);
    if (genres.length > 0) enrichment.genres = genres;
    if (imageUrl) enrichment.imageUrl = imageUrl;

    const ids = plexIds(item);
    const mbid = musicBrainzId(item);
    if (mbid) ids.push({ source: SOURCE_MUSICBRAINZ_ARTIST, id: mbid });
    enrichment.externalIds = ids;
    return enrichment;
}

/** What the server says about a record: its label, its date, its styles, its cover. */
export function mapAlbumEnrichment(item: PlexMetadata, artworkUrl?: string): Partial<AlbumEnrichment> {
    const enrichment: Partial<AlbumEnrichment> = {};
    const key = text(item.ratingKey);
    if (!key) return enrichment;
    enrichment.providerRef = key;

    const name = text(item.title);
    if (name) enrichment.name = name;
    const artist = text(item.parentTitle);
    if (artist) enrichment.artist = artist;
    const year = trackYear({ year: item.year });
    if (year !== undefined) enrichment.year = year;
    const date = releaseDate(item.originallyAvailableAt);
    if (date) enrichment.releaseDate = date;
    const label = text(item.studio);
    if (label) enrichment.label = label;
    const genres = tags(item.Style, item.Genre);
    if (genres.length > 0) enrichment.genres = genres;
    if (artworkUrl) enrichment.artworkUrl = artworkUrl;

    const ids = plexIds(item);
    const mbid = musicBrainzId(item);
    if (mbid) ids.push({ source: SOURCE_MUSICBRAINZ_RELEASE, id: mbid });
    enrichment.externalIds = ids;
    return enrichment;
}
