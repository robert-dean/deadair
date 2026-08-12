import { z } from 'zod';
import { DateTime } from 'luxon';
import { Pagination } from '../../shared/types/pagination.js';
import { PaginationInput } from '../../shared/types/pagination.js';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * What the station has been told about a record. `neutral` is the absence of an opinion rather than
 * a middling one, and it is what rating something back to nothing means.
 * generated from [Rating](file://./../../../../data/contracts/catalog/catalog.types.ck#L9)
 */
export const Rating = z.enum(['liked', 'neutral', 'disliked']);
export type Rating = z.infer<typeof Rating>;

/**
 * Pagination plus a name filter. Every list operation here takes it, so the console's search box
 * narrows server-side rather than filtering one page client-side and lying about the total.
 * generated from [CatalogQuery](file://./../../../../data/contracts/catalog/catalog.types.ck#L65)
 */
export const CatalogQuery = Pagination.extend({
    search: z.string().min(1).max(200).optional(),
});
export type CatalogQuery = z.infer<typeof CatalogQuery>;

export const CatalogQueryInput = PaginationInput.extend({
    search: z.string().min(1).max(200).optional(),
});
export type CatalogQueryInput = z.infer<typeof CatalogQueryInput>;

/**
 * generated from [EnrichmentExternalId](file://./../../../../data/contracts/catalog/catalog.types.ck#L95)
 */
export const EnrichmentExternalId = z.strictObject({
    source: z.string().min(1).max(200).describe('e.g. `musicbrainz`, `wikidata`'),
    id: z.string().min(1).max(200),
});
export type EnrichmentExternalId = z.infer<typeof EnrichmentExternalId>;

/**
 * Narrowed to http(s) by the host before it is stored, since the console renders these as
 * something a human clicks.
 * generated from [EnrichmentLink](file://./../../../../data/contracts/catalog/catalog.types.ck#L102)
 */
export const EnrichmentLink = z.strictObject({
    label: z.string().min(1).max(200),
    url: z.string().min(1).max(2000),
});
export type EnrichmentLink = z.infer<typeof EnrichmentLink>;

/**
 * Rate an artist, a record or a song. Ratings are absolute: a dislike anywhere above a track
 * excludes it, and nothing the station programmes may turn that off.
 * generated from [RateInput](file://./../../../../data/contracts/catalog/catalog.types.ck#L13)
 */
export const RateInput = z.strictObject({
    rating: Rating,
});
export type RateInput = z.infer<typeof RateInput>;

/**
 * The canonical work, not a binding to a provider. `deadair.artists` minus the columns that
 * only ingest cares about: `artist_key` is a match key, and a row with `merged_into_id` set is
 * never read out at all.
 *
 * `imageUrl` on both contracts below is one field with two spellings. An absolute URL is the
 * provider's own, still hotlinked because nothing has cached it yet; a relative `art/<uuid>` is
 * the station's copy, to be resolved against the API base the client already configures (the API
 * mounts at the root and does not know the `/api` prefix the edge adds). Prefer the local one by
 * doing nothing: the switch happens server-side as soon as the art cache pass has the bytes.
 * generated from [Artist](file://./../../../../data/contracts/catalog/catalog.types.ck#L26)
 */
export const Artist = z.strictObject({
    id: z.uuid(),
    name: z.string(),
    mbid: z.uuid().optional().describe('MusicBrainz artist id, absent until enrichment resolves one'),
    imageUrl: z.string().optional().describe('Absolute upstream URL, or an API-relative path to the local copy'),
    rating: Rating.default('neutral'),
    albumCount: z.coerce.number().int().min(0).describe('Unmerged albums credited to this artist'),
    trackCount: z.coerce.number().int().min(0).describe('Unmerged tracks credited to this artist'),
});
export type Artist = z.infer<typeof Artist>;

export const ArtistInput = z.strictObject({
    name: z.string(),
    mbid: z.uuid().optional().describe('MusicBrainz artist id, absent until enrichment resolves one'),
    imageUrl: z.string().optional().describe('Absolute upstream URL, or an API-relative path to the local copy'),
    rating: Rating.default('neutral'),
});
export type ArtistInput = z.infer<typeof ArtistInput>;

/**
 * generated from [Album](file://./../../../../data/contracts/catalog/catalog.types.ck#L36)
 */
export const Album = z.strictObject({
    id: z.uuid(),
    name: z.string(),
    artistId: z.uuid(),
    artistName: z.string().describe('Joined, so a list renders without a second request per row'),
    mbid: z.uuid().optional().describe('MusicBrainz release-group id, absent until enrichment resolves one'),
    year: z.coerce.number().int().optional(),
    imageUrl: z.string().optional().describe('Absolute upstream URL, or an API-relative path to the local copy'),
    rating: Rating.default('neutral'),
    trackCount: z.coerce.number().int().min(0),
});
export type Album = z.infer<typeof Album>;

export const AlbumInput = z.strictObject({
    name: z.string(),
    mbid: z.uuid().optional().describe('MusicBrainz release-group id, absent until enrichment resolves one'),
    year: z.coerce.number().int().optional(),
    imageUrl: z.string().optional().describe('Absolute upstream URL, or an API-relative path to the local copy'),
    rating: Rating.default('neutral'),
});
export type AlbumInput = z.infer<typeof AlbumInput>;

/**
 * generated from [Track](file://./../../../../data/contracts/catalog/catalog.types.ck#L48)
 */
export const Track = z.strictObject({
    id: z.uuid(),
    title: z.string(),
    artistId: z.uuid(),
    artistName: z.string(),
    albumId: z.uuid().optional().describe('Absent on a single ingested outside any release: `tracks.album_id` is nullable'),
    albumName: z.string().optional(),
    albumImageUrl: z.string().optional().describe("The record's cover, in the two spellings `Album.imageUrl` has. Nothing hangs art off a recording"),
    artists: z.string().describe('Display credit as written on the release ("X feat. Y"), not a join key'),
    genre: z.string().optional(),
    year: z.coerce.number().int().optional(),
    durationMs: z.coerce.number().int().min(0).optional(),
    rating: Rating.default('neutral'),
});
export type Track = z.infer<typeof Track>;

export const TrackInput = z.strictObject({
    title: z.string(),
    artists: z.string().describe('Display credit as written on the release ("X feat. Y"), not a join key'),
    genre: z.string().optional(),
    year: z.coerce.number().int().optional(),
    durationMs: z.coerce.number().int().min(0).optional(),
    rating: Rating.default('neutral'),
});
export type TrackInput = z.infer<typeof TrackInput>;

/**
 * `releaseDate` is a string and not `datetime` because it is a partial date: MusicBrainz answers
 * `1997`, `1997-06` or `1997-06-24` depending on what is actually known about the release, and the
 * SDK types it the same way. A `datetime` would reject the first two or invent a day and a time
 * for them, which is a precision the source never claimed.
 * generated from [TrackEnrichmentData](file://./../../../../data/contracts/catalog/catalog.types.ck#L111)
 */
export const TrackEnrichmentData = z.strictObject({
    artist: z.string().max(2000).optional(),
    title: z.string().max(2000).optional(),
    album: z.string().max(2000).optional(),
    year: z.coerce.number().int().optional(),
    releaseDate: z.string().max(10).optional(),
    genres: z.array(z.string().max(2000)).optional(),
    moods: z.array(z.string().max(2000)).optional(),
    biography: z.string().max(20000).optional(),
    facts: z.array(z.string().max(2000)).optional().describe('Short lines, each independently speakable'),
    bpm: z.coerce.number().optional().describe('Not an integer: a tempo a source measured rather than declared is fractional'),
    musicalKey: z.string().max(2000).optional(),
    label: z.string().max(2000).optional(),
    isrc: z.string().max(2000).optional(),
    artworkUrl: z.string().max(2000).optional(),
    externalIds: z.array(EnrichmentExternalId).optional(),
    links: z.array(EnrichmentLink).optional(),
    extra: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('What the plugin said that the SDK has no field for. Per provider only: the merged view drops it'),
});
export type TrackEnrichmentData = z.infer<typeof TrackEnrichmentData>;

/**
 * generated from [ArtistEnrichmentData](file://./../../../../data/contracts/catalog/catalog.types.ck#L131)
 */
export const ArtistEnrichmentData = z.strictObject({
    name: z.string().max(2000).optional(),
    biography: z.string().max(20000).optional(),
    imageUrl: z.string().max(2000).optional(),
    genres: z.array(z.string().max(2000)).optional(),
    facts: z.array(z.string().max(2000)).optional(),
    externalIds: z.array(EnrichmentExternalId).optional(),
    links: z.array(EnrichmentLink).optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
});
export type ArtistEnrichmentData = z.infer<typeof ArtistEnrichmentData>;

/**
 * generated from [AlbumEnrichmentData](file://./../../../../data/contracts/catalog/catalog.types.ck#L142)
 */
export const AlbumEnrichmentData = z.strictObject({
    name: z.string().max(2000).optional(),
    artist: z.string().max(2000).optional().describe("The record's own credit, which is not always the track's"),
    year: z.coerce.number().int().optional(),
    releaseDate: z.string().max(10).optional().describe('Partial, exactly as on TrackEnrichmentData'),
    label: z.string().max(2000).optional(),
    genres: z.array(z.string().max(2000)).optional(),
    facts: z.array(z.string().max(2000)).optional(),
    artworkUrl: z.string().max(2000).optional(),
    externalIds: z.array(EnrichmentExternalId).optional(),
    links: z.array(EnrichmentLink).optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
});
export type AlbumEnrichmentData = z.infer<typeof AlbumEnrichmentData>;

/**
 * One page of artists, with the totals the request was counted against
 * generated from [ArtistPage](file://./../../../../data/contracts/catalog/catalog.types.ck#L76)
 */
export const ArtistPage = z.strictObject({
    meta: Pagination,
    data: z.array(Artist),
});
export type ArtistPage = z.infer<typeof ArtistPage>;

export const ArtistPageInput = z.strictObject({
    meta: PaginationInput,
    data: z.array(ArtistInput),
});
export type ArtistPageInput = z.infer<typeof ArtistPageInput>;

/**
 * One page of albums
 * generated from [AlbumPage](file://./../../../../data/contracts/catalog/catalog.types.ck#L81)
 */
export const AlbumPage = z.strictObject({
    meta: Pagination,
    data: z.array(Album),
});
export type AlbumPage = z.infer<typeof AlbumPage>;

export const AlbumPageInput = z.strictObject({
    meta: PaginationInput,
    data: z.array(AlbumInput),
});
export type AlbumPageInput = z.infer<typeof AlbumPageInput>;

/**
 * One page of tracks
 * generated from [TrackPage](file://./../../../../data/contracts/catalog/catalog.types.ck#L86)
 */
export const TrackPage = z.strictObject({
    meta: Pagination,
    data: z.array(Track),
});
export type TrackPage = z.infer<typeof TrackPage>;

export const TrackPageInput = z.strictObject({
    meta: PaginationInput,
    data: z.array(TrackInput),
});
export type TrackPageInput = z.infer<typeof TrackPageInput>;

/**
 * One provider's stored answer. `found: false` is a recorded miss, which is a fact rather than a
 * failure: the provider was asked, had nothing, and is not asked again until `expiresAt`.
 * generated from [TrackEnrichmentSource](file://./../../../../data/contracts/catalog/catalog.types.ck#L158)
 */
export const TrackEnrichmentSource = z.strictObject({
    provider: z.string().min(1).max(200),
    providerRef: z.string().max(200).optional().describe('The id it was fetched under. Provenance, not identity'),
    fetchedAt: _ZodDatetime,
    expiresAt: _ZodDatetime.optional(),
    stale: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Past its TTL, so the next pass will ask again'),
    found: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    data: TrackEnrichmentData,
});
export type TrackEnrichmentSource = z.infer<typeof TrackEnrichmentSource>;

export const TrackEnrichmentSourceInput = z.strictObject({
    data: TrackEnrichmentData,
});
export type TrackEnrichmentSourceInput = z.infer<typeof TrackEnrichmentSourceInput>;

/**
 * generated from [ArtistEnrichmentSource](file://./../../../../data/contracts/catalog/catalog.types.ck#L168)
 */
export const ArtistEnrichmentSource = z.strictObject({
    provider: z.string().min(1).max(200),
    providerRef: z.string().max(200).optional(),
    fetchedAt: _ZodDatetime,
    expiresAt: _ZodDatetime.optional(),
    stale: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    found: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    data: ArtistEnrichmentData,
});
export type ArtistEnrichmentSource = z.infer<typeof ArtistEnrichmentSource>;

export const ArtistEnrichmentSourceInput = z.strictObject({
    data: ArtistEnrichmentData,
});
export type ArtistEnrichmentSourceInput = z.infer<typeof ArtistEnrichmentSourceInput>;

/**
 * generated from [AlbumEnrichmentSource](file://./../../../../data/contracts/catalog/catalog.types.ck#L178)
 */
export const AlbumEnrichmentSource = z.strictObject({
    provider: z.string().min(1).max(200),
    providerRef: z.string().max(200).optional(),
    fetchedAt: _ZodDatetime,
    expiresAt: _ZodDatetime.optional(),
    stale: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    found: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    data: AlbumEnrichmentData,
});
export type AlbumEnrichmentSource = z.infer<typeof AlbumEnrichmentSource>;

export const AlbumEnrichmentSourceInput = z.strictObject({
    data: AlbumEnrichmentData,
});
export type AlbumEnrichmentSourceInput = z.infer<typeof AlbumEnrichmentSourceInput>;

/**
 * Every provider's answer, plus the same merge the promotion step used, so the console and the
 * canonical columns cannot tell different stories. `sources` is empty on a row the walk has not
 * reached yet.
 * generated from [TrackEnrichmentDetail](file://./../../../../data/contracts/catalog/catalog.types.ck#L191)
 */
export const TrackEnrichmentDetail = z.strictObject({
    trackId: z.uuid(),
    merged: TrackEnrichmentData,
    sources: z.array(TrackEnrichmentSource),
});
export type TrackEnrichmentDetail = z.infer<typeof TrackEnrichmentDetail>;

export const TrackEnrichmentDetailInput = z.strictObject({
    merged: TrackEnrichmentData,
    sources: z.array(TrackEnrichmentSourceInput),
});
export type TrackEnrichmentDetailInput = z.infer<typeof TrackEnrichmentDetailInput>;

/**
 * generated from [ArtistEnrichmentDetail](file://./../../../../data/contracts/catalog/catalog.types.ck#L197)
 */
export const ArtistEnrichmentDetail = z.strictObject({
    artistId: z.uuid(),
    merged: ArtistEnrichmentData,
    sources: z.array(ArtistEnrichmentSource),
});
export type ArtistEnrichmentDetail = z.infer<typeof ArtistEnrichmentDetail>;

export const ArtistEnrichmentDetailInput = z.strictObject({
    merged: ArtistEnrichmentData,
    sources: z.array(ArtistEnrichmentSourceInput),
});
export type ArtistEnrichmentDetailInput = z.infer<typeof ArtistEnrichmentDetailInput>;

/**
 * generated from [AlbumEnrichmentDetail](file://./../../../../data/contracts/catalog/catalog.types.ck#L203)
 */
export const AlbumEnrichmentDetail = z.strictObject({
    albumId: z.uuid(),
    merged: AlbumEnrichmentData,
    sources: z.array(AlbumEnrichmentSource),
});
export type AlbumEnrichmentDetail = z.infer<typeof AlbumEnrichmentDetail>;

export const AlbumEnrichmentDetailInput = z.strictObject({
    merged: AlbumEnrichmentData,
    sources: z.array(AlbumEnrichmentSourceInput),
});
export type AlbumEnrichmentDetailInput = z.infer<typeof AlbumEnrichmentDetailInput>;
