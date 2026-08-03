import { z } from 'zod';

/**
 * A playlist a catalog-capable plugin offers, tagged with the plugin it came from so an aggregated list is addressable
 * generated from [CatalogPlaylist](file://./../../../../data/contracts/playlists/playlists.types.ck#L8)
 */
export const CatalogPlaylist = z.strictObject({
    pluginId: z.string().min(1).max(200),
    pluginName: z.string().min(1).max(200),
    id: z.string().min(1).max(400),
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    trackCount: z.coerce.number().optional(),
    artworkUrl: z.string().max(2000).optional(),
});
export type CatalogPlaylist = z.infer<typeof CatalogPlaylist>;

/**
 * Mirrors the plugin SDK's `ProviderTrack`
 * generated from [CatalogTrack](file://./../../../../data/contracts/playlists/playlists.types.ck#L19)
 */
export const CatalogTrack = z.strictObject({
    id: z.string().min(1).max(400),
    title: z.string().min(1).max(400),
    artists: z.array(z.string().min(1).max(200)).describe('Ordered, primary artist first. Empty array if the provider genuinely has none'),
    album: z.string().max(400).optional(),
    durationMs: z.coerce.number().optional(),
    isrc: z.string().max(100).optional(),
    artworkUrl: z.string().max(2000).optional(),
});
export type CatalogTrack = z.infer<typeof CatalogTrack>;

/**
 * One catalog-capable plugin that could not be listed
 * generated from [CatalogSourceError](file://./../../../../data/contracts/playlists/playlists.types.ck#L30)
 */
export const CatalogSourceError = z.strictObject({
    pluginId: z.string().min(1).max(200),
    pluginName: z.string().min(1).max(200),
    message: z.string().max(4000),
});
export type CatalogSourceError = z.infer<typeof CatalogSourceError>;

/**
 * generated from [CatalogPlaylistTracks](file://./../../../../data/contracts/playlists/playlists.types.ck#L41)
 */
export const CatalogPlaylistTracks = z.strictObject({
    pluginId: z.string().min(1).max(200),
    playlistId: z.string().min(1).max(400),
    tracks: z.array(CatalogTrack),
});
export type CatalogPlaylistTracks = z.infer<typeof CatalogPlaylistTracks>;

/**
 * generated from [CatalogPlaylistPage](file://./../../../../data/contracts/playlists/playlists.types.ck#L36)
 */
export const CatalogPlaylistPage = z.strictObject({
    playlists: z.array(CatalogPlaylist),
    errors: z.array(CatalogSourceError),
});
export type CatalogPlaylistPage = z.infer<typeof CatalogPlaylistPage>;
