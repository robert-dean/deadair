import type { Pagination } from '../../shared/types/pagination.js';
import type { PaginationInput } from '../../shared/types/pagination.js';

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
 * generated from [Artist](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L16)
 */
export interface Artist {
    id: string;
    name: string;
    /** MusicBrainz artist id, absent until enrichment resolves one */
    mbid?: string;
    /** Absolute upstream URL, or an API-relative path to the local copy */
    imageUrl?: string;
    rating?: number;
    /** Unmerged albums credited to this artist */
    albumCount: number;
    /** Unmerged tracks credited to this artist */
    trackCount: number;
}

export interface ArtistInput {
    name: string;
    /** MusicBrainz artist id, absent until enrichment resolves one */
    mbid?: string;
    /** Absolute upstream URL, or an API-relative path to the local copy */
    imageUrl?: string;
    rating?: number;
}

/**
 * generated from [Album](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L26)
 */
export interface Album {
    id: string;
    name: string;
    artistId: string;
    /** Joined, so a list renders without a second request per row */
    artistName: string;
    /** MusicBrainz release-group id, absent until enrichment resolves one */
    mbid?: string;
    year?: number;
    /** Absolute upstream URL, or an API-relative path to the local copy */
    imageUrl?: string;
    rating?: number;
    trackCount: number;
}

export interface AlbumInput {
    name: string;
    /** MusicBrainz release-group id, absent until enrichment resolves one */
    mbid?: string;
    year?: number;
    /** Absolute upstream URL, or an API-relative path to the local copy */
    imageUrl?: string;
    rating?: number;
}

/**
 * generated from [Track](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L38)
 */
export interface Track {
    id: string;
    title: string;
    artistId: string;
    artistName: string;
    /** Absent on a single ingested outside any release: `tracks.album_id` is nullable */
    albumId?: string;
    albumName?: string;
    /** The record's cover, in the two spellings `Album.imageUrl` has. Nothing hangs art off a recording */
    albumImageUrl?: string;
    /** Display credit as written on the release ("X feat. Y"), not a join key */
    artists: string;
    genre?: string;
    year?: number;
    durationMs?: number;
    rating?: number;
}

export interface TrackInput {
    title: string;
    /** Display credit as written on the release ("X feat. Y"), not a join key */
    artists: string;
    genre?: string;
    year?: number;
    durationMs?: number;
    rating?: number;
}

/**
 * Pagination plus a name filter. Every list operation here takes it, so the console's search box
 * narrows server-side rather than filtering one page client-side and lying about the total.
 * generated from [CatalogQuery](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L55)
 */
export interface CatalogQuery extends Pagination {
    search?: string;
}

export interface CatalogQueryInput extends PaginationInput {
    search?: string;
}

/**
 * What enrichment stored, read back. Three payload shapes because the SDK has three: a recording,
 * a performer and a record are asked about separately and know different things. The caps mirror
 * the ones `enrichment.merge.ts` sanitizes to; change them together.
 * generated from [EnrichmentExternalId](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L85)
 */
export interface EnrichmentExternalId {
    /** e.g. `musicbrainz`, `wikidata` */
    source: string;
    id: string;
}

/**
 * Narrowed to http(s) by the host before it is stored, since the console renders these as
 * something a human clicks.
 * generated from [EnrichmentLink](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L92)
 */
export interface EnrichmentLink {
    label: string;
    url: string;
}

/**
 * One page of each row type. Declared rather than inlined on the five list operations, so the shape
 * has a name the console can import instead of restating `{ meta, data }` at every call site.
 *
 * Three near-identical contracts because the DSL has no generics. That is the honest expression of
 * it: a union would type `data` as "artists or albums or tracks" and lose which one a given
 * operation returns.
 * generated from [ArtistPage](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L66)
 */
export interface ArtistPage {
    /** One page of artists, with the totals the request was counted against */
    meta: Pagination;
    data: Artist[];
}

export interface ArtistPageInput {
    /** One page of artists, with the totals the request was counted against */
    meta: PaginationInput;
    data: ArtistInput[];
}

/**
 * One page of albums
 * generated from [AlbumPage](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L71)
 */
export interface AlbumPage {
    /** One page of albums */
    meta: Pagination;
    data: Album[];
}

export interface AlbumPageInput {
    /** One page of albums */
    meta: PaginationInput;
    data: AlbumInput[];
}

/**
 * One page of tracks
 * generated from [TrackPage](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L76)
 */
export interface TrackPage {
    /** One page of tracks */
    meta: Pagination;
    data: Track[];
}

export interface TrackPageInput {
    /** One page of tracks */
    meta: PaginationInput;
    data: TrackInput[];
}

/**
 * `releaseDate` is a string and not `datetime` because it is a partial date: MusicBrainz answers
 * `1997`, `1997-06` or `1997-06-24` depending on what is actually known about the release, and the
 * SDK types it the same way. A `datetime` would reject the first two or invent a day and a time
 * for them, which is a precision the source never claimed.
 * generated from [TrackEnrichmentData](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L101)
 */
export interface TrackEnrichmentData {
    artist?: string;
    title?: string;
    album?: string;
    year?: number;
    releaseDate?: string;
    genres?: string[];
    moods?: string[];
    biography?: string;
    /** Short lines, each independently speakable */
    facts?: string[];
    /** Not an integer: a tempo a source measured rather than declared is fractional */
    bpm?: number;
    musicalKey?: string;
    label?: string;
    isrc?: string;
    artworkUrl?: string;
    externalIds?: EnrichmentExternalId[];
    links?: EnrichmentLink[];
    /** What the plugin said that the SDK has no field for. Per provider only: the merged view drops it */
    extra?: Record<string, unknown>;
}

/**
 * generated from [ArtistEnrichmentData](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L121)
 */
export interface ArtistEnrichmentData {
    name?: string;
    biography?: string;
    imageUrl?: string;
    genres?: string[];
    facts?: string[];
    externalIds?: EnrichmentExternalId[];
    links?: EnrichmentLink[];
    extra?: Record<string, unknown>;
}

/**
 * generated from [AlbumEnrichmentData](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L132)
 */
export interface AlbumEnrichmentData {
    name?: string;
    /** The record's own credit, which is not always the track's */
    artist?: string;
    year?: number;
    /** Partial, exactly as on TrackEnrichmentData */
    releaseDate?: string;
    label?: string;
    genres?: string[];
    facts?: string[];
    artworkUrl?: string;
    externalIds?: EnrichmentExternalId[];
    links?: EnrichmentLink[];
    extra?: Record<string, unknown>;
}

/**
 * One provider's stored answer. `found: false` is a recorded miss, which is a fact rather than a
 * failure: the provider was asked, had nothing, and is not asked again until `expiresAt`.
 * generated from [TrackEnrichmentSource](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L148)
 */
export interface TrackEnrichmentSource {
    provider: string;
    /** The id it was fetched under. Provenance, not identity */
    providerRef?: string;
    fetchedAt: string;
    expiresAt?: string;
    /** Past its TTL, so the next pass will ask again */
    stale: boolean;
    found: boolean;
    data: TrackEnrichmentData;
}

export interface TrackEnrichmentSourceInput {
    data: TrackEnrichmentData;
}

/**
 * generated from [ArtistEnrichmentSource](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L158)
 */
export interface ArtistEnrichmentSource {
    provider: string;
    providerRef?: string;
    fetchedAt: string;
    expiresAt?: string;
    stale: boolean;
    found: boolean;
    data: ArtistEnrichmentData;
}

export interface ArtistEnrichmentSourceInput {
    data: ArtistEnrichmentData;
}

/**
 * generated from [AlbumEnrichmentSource](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L168)
 */
export interface AlbumEnrichmentSource {
    provider: string;
    providerRef?: string;
    fetchedAt: string;
    expiresAt?: string;
    stale: boolean;
    found: boolean;
    data: AlbumEnrichmentData;
}

export interface AlbumEnrichmentSourceInput {
    data: AlbumEnrichmentData;
}

/**
 * Every provider's answer, plus the same merge the promotion step used, so the console and the
 * canonical columns cannot tell different stories. `sources` is empty on a row the walk has not
 * reached yet.
 * generated from [TrackEnrichmentDetail](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L181)
 */
export interface TrackEnrichmentDetail {
    trackId: string;
    merged: TrackEnrichmentData;
    sources: TrackEnrichmentSource[];
}

export interface TrackEnrichmentDetailInput {
    merged: TrackEnrichmentData;
    sources: TrackEnrichmentSourceInput[];
}

/**
 * generated from [ArtistEnrichmentDetail](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L187)
 */
export interface ArtistEnrichmentDetail {
    artistId: string;
    merged: ArtistEnrichmentData;
    sources: ArtistEnrichmentSource[];
}

export interface ArtistEnrichmentDetailInput {
    merged: ArtistEnrichmentData;
    sources: ArtistEnrichmentSourceInput[];
}

/**
 * generated from [AlbumEnrichmentDetail](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L193)
 */
export interface AlbumEnrichmentDetail {
    albumId: string;
    merged: AlbumEnrichmentData;
    sources: AlbumEnrichmentSource[];
}

export interface AlbumEnrichmentDetailInput {
    merged: AlbumEnrichmentData;
    sources: AlbumEnrichmentSourceInput[];
}
