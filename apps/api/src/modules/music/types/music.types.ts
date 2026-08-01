import { z } from 'zod';

/**
 * generated from [Artist](file://./../../../../data/contracts/music/music.types.ck#L7)
 */
export const Artist = z.strictObject({
    id: z.uuid(),
    name: z.string(),
    rating: z.coerce.number().int().min(-1).max(1).default(0),
});
export type Artist = z.infer<typeof Artist>;

export const ArtistInput = z.strictObject({
    name: z.string(),
    rating: z.coerce.number().int().min(-1).max(1).default(0),
});
export type ArtistInput = z.infer<typeof ArtistInput>;

/**
 * generated from [Album](file://./../../../../data/contracts/music/music.types.ck#L13)
 */
export const Album = z.strictObject({
    id: z.uuid(),
    name: z.string(),
    artistId: z.uuid(),
    rating: z.coerce.number().int().min(-1).max(1).default(0),
});
export type Album = z.infer<typeof Album>;

export const AlbumInput = z.strictObject({
    name: z.string(),
    rating: z.coerce.number().int().min(-1).max(1).default(0),
});
export type AlbumInput = z.infer<typeof AlbumInput>;

/**
 * generated from [Track](file://./../../../../data/contracts/music/music.types.ck#L20)
 */
export const Track = z.strictObject({
    id: z.uuid(),
    title: z.string(),
    artistId: z.uuid(),
    albumId: z.uuid(),
    rating: z.coerce.number().int().min(-1).max(1).default(0),
});
export type Track = z.infer<typeof Track>;

export const TrackInput = z.strictObject({
    title: z.string(),
    rating: z.coerce.number().int().min(-1).max(1).default(0),
});
export type TrackInput = z.infer<typeof TrackInput>;
