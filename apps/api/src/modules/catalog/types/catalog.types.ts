import { z } from 'zod';
import { Pagination } from '../../shared/types/pagination.js';
import { PaginationInput } from '../../shared/types/pagination.js';

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
 * generated from [Artist](file://./../../../../data/contracts/catalog/catalog.types.ck#L16)
 */
export const Artist = z.strictObject({
    id: z.uuid(),
    name: z.string(),
    mbid: z.uuid().optional().describe('MusicBrainz artist id, absent until enrichment resolves one'),
    imageUrl: z.string().optional().describe('Absolute upstream URL, or an API-relative path to the local copy'),
    rating: z.coerce.number().int().min(-1).max(1).default(0),
    albumCount: z.coerce.number().int().min(0).describe('Unmerged albums credited to this artist'),
    trackCount: z.coerce.number().int().min(0).describe('Unmerged tracks credited to this artist'),
});
export type Artist = z.infer<typeof Artist>;

export const ArtistInput = z.strictObject({
    name: z.string(),
    mbid: z.uuid().optional().describe('MusicBrainz artist id, absent until enrichment resolves one'),
    imageUrl: z.string().optional().describe('Absolute upstream URL, or an API-relative path to the local copy'),
    rating: z.coerce.number().int().min(-1).max(1).default(0),
});
export type ArtistInput = z.infer<typeof ArtistInput>;

/**
 * generated from [Album](file://./../../../../data/contracts/catalog/catalog.types.ck#L26)
 */
export const Album = z.strictObject({
    id: z.uuid(),
    name: z.string(),
    artistId: z.uuid(),
    artistName: z.string().describe('Joined, so a list renders without a second request per row'),
    year: z.coerce.number().int().optional(),
    imageUrl: z.string().optional().describe('Absolute upstream URL, or an API-relative path to the local copy'),
    rating: z.coerce.number().int().min(-1).max(1).default(0),
    trackCount: z.coerce.number().int().min(0),
});
export type Album = z.infer<typeof Album>;

export const AlbumInput = z.strictObject({
    name: z.string(),
    year: z.coerce.number().int().optional(),
    imageUrl: z.string().optional().describe('Absolute upstream URL, or an API-relative path to the local copy'),
    rating: z.coerce.number().int().min(-1).max(1).default(0),
});
export type AlbumInput = z.infer<typeof AlbumInput>;

/**
 * generated from [Track](file://./../../../../data/contracts/catalog/catalog.types.ck#L37)
 */
export const Track = z.strictObject({
    id: z.uuid(),
    title: z.string(),
    artistId: z.uuid(),
    artistName: z.string(),
    albumId: z.uuid().optional().describe('Absent on a single ingested outside any release: `tracks.album_id` is nullable'),
    albumName: z.string().optional(),
    artists: z.string().describe('Display credit as written on the release ("X feat. Y"), not a join key'),
    genre: z.string().optional(),
    year: z.coerce.number().int().optional(),
    durationMs: z.coerce.number().int().min(0).optional(),
    rating: z.coerce.number().int().min(-1).max(1).default(0),
});
export type Track = z.infer<typeof Track>;

export const TrackInput = z.strictObject({
    title: z.string(),
    artists: z.string().describe('Display credit as written on the release ("X feat. Y"), not a join key'),
    genre: z.string().optional(),
    year: z.coerce.number().int().optional(),
    durationMs: z.coerce.number().int().min(0).optional(),
    rating: z.coerce.number().int().min(-1).max(1).default(0),
});
export type TrackInput = z.infer<typeof TrackInput>;

/**
 * Pagination plus a name filter. Every list operation here takes it, so the console's search box
 * narrows server-side rather than filtering one page client-side and lying about the total.
 * generated from [CatalogQuery](file://./../../../../data/contracts/catalog/catalog.types.ck#L53)
 */
export const CatalogQuery = Pagination.extend({
    search: z.string().min(1).max(200).optional(),
});
export type CatalogQuery = z.infer<typeof CatalogQuery>;

export const CatalogQueryInput = PaginationInput.extend({
    search: z.string().min(1).max(200).optional(),
});
export type CatalogQueryInput = z.infer<typeof CatalogQueryInput>;
