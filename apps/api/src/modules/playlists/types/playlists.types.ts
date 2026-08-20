import { z } from 'zod';

/**
 * An action a source will permit on one playlist's items. Item-scoped: neither value covers the playlist's own name or description
 * generated from [PlaylistPermission](file://./../../../../data/contracts/playlists/playlists.types.ck#L8)
 */
export const PlaylistPermission = z.enum(['read', 'edit']);
export type PlaylistPermission = z.infer<typeof PlaylistPermission>;

/**
 * One record as its PROVIDER describes it, plus what the catalog can say about the same copy.
 *
 * The first half mirrors the plugin SDK's `ProviderTrack` and stays the provider's answer: this is a
 * listing of what a playlist holds, not of what the station has ingested. The three ids below are the
 * station's own and are absent for anything it has never seen, which on most playlists is plenty of
 * rows — a playlist is a provider's list and the library is what a sync has walked
 * generated from [CatalogTrack](file://./../../../../data/contracts/playlists/playlists.types.ck#L28)
 */
export const CatalogTrack = z.strictObject({
    id: z.string().min(1).max(400).describe("The PROVIDER's id for this copy, which is what an import names it by. Never a `deadair.tracks` id"),
    title: z.string().min(1).max(400),
    artists: z.array(z.string().min(1).max(200)).describe('Ordered, primary artist first. Empty array if the provider genuinely has none'),
    album: z.string().max(400).optional(),
    durationMs: z.coerce.number().int().min(0).optional(),
    isrc: z.string().max(100).optional(),
    artworkUrl: z.string().max(2000).optional(),
    trackId: z.string().max(100).optional().describe('The canonical `deadair.tracks` row this copy is bound to, when the catalog holds one'),
    artistId: z.string().max(100).optional().describe('The canonical artist behind that row'),
    albumId: z.string().max(100).optional().describe('The release that row was ingested inside. Absent for a single ingested outside any'),
});
export type CatalogTrack = z.infer<typeof CatalogTrack>;

/**
 * One catalog-capable plugin that could not be listed
 * generated from [CatalogSourceError](file://./../../../../data/contracts/playlists/playlists.types.ck#L42)
 */
export const CatalogSourceError = z.strictObject({
    pluginId: z.string().min(1).max(200),
    pluginName: z.string().min(1).max(200),
    message: z.string().max(4000),
});
export type CatalogSourceError = z.infer<typeof CatalogSourceError>;

/**
 * A playlist a catalog-capable plugin offers, tagged with the plugin it came from so an aggregated list is addressable
 * generated from [CatalogPlaylist](file://./../../../../data/contracts/playlists/playlists.types.ck#L11)
 */
export const CatalogPlaylist = z.strictObject({
    pluginId: z.string().min(1).max(200),
    pluginName: z.string().min(1).max(200),
    id: z.string().min(1).max(400),
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    trackCount: z.coerce.number().int().min(0).optional(),
    artworkUrl: z.string().max(2000).optional(),
    permissions: z
        .array(PlaylistPermission)
        .optional()
        .describe(
            "What the SOURCE permits on this playlist's items, not what this actor may do. Empty means the source permits nothing; absent means it did not say",
        ),
});
export type CatalogPlaylist = z.infer<typeof CatalogPlaylist>;

/**
 * generated from [CatalogPlaylistTracks](file://./../../../../data/contracts/playlists/playlists.types.ck#L53)
 */
export const CatalogPlaylistTracks = z.strictObject({
    pluginId: z.string().min(1).max(200),
    playlistId: z.string().min(1).max(400),
    tracks: z.array(CatalogTrack),
});
export type CatalogPlaylistTracks = z.infer<typeof CatalogPlaylistTracks>;

/**
 * generated from [CatalogPlaylistPage](file://./../../../../data/contracts/playlists/playlists.types.ck#L48)
 */
export const CatalogPlaylistPage = z.strictObject({
    playlists: z.array(CatalogPlaylist),
    errors: z.array(CatalogSourceError),
});
export type CatalogPlaylistPage = z.infer<typeof CatalogPlaylistPage>;
