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
    year?: number;
    /** Absolute upstream URL, or an API-relative path to the local copy */
    imageUrl?: string;
    rating?: number;
    trackCount: number;
}

export interface AlbumInput {
    name: string;
    year?: number;
    /** Absolute upstream URL, or an API-relative path to the local copy */
    imageUrl?: string;
    rating?: number;
}

/**
 * generated from [Track](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L37)
 */
export interface Track {
    id: string;
    title: string;
    artistId: string;
    artistName: string;
    /** Absent on a single ingested outside any release: `tracks.album_id` is nullable */
    albumId?: string;
    albumName?: string;
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
 * generated from [CatalogQuery](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L53)
 */
export interface CatalogQuery extends Pagination {
    search?: string;
}

export interface CatalogQueryInput extends PaginationInput {
    search?: string;
}
