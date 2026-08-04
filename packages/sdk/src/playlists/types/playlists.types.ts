/**
 * An action a source will permit on one playlist's items. Item-scoped: neither value covers the playlist's own name or description
 * generated from [PlaylistPermission](file://./../../../../../apps/api/data/contracts/playlists/playlists.types.ck#L8)
 */
export type PlaylistPermission = 'read' | 'edit';

/**
 * Mirrors the plugin SDK's `ProviderTrack`
 * generated from [CatalogTrack](file://./../../../../../apps/api/data/contracts/playlists/playlists.types.ck#L23)
 */
export interface CatalogTrack {
    id: string;
    title: string;
    /** Ordered, primary artist first. Empty array if the provider genuinely has none */
    artists: string[];
    album?: string;
    durationMs?: number;
    isrc?: string;
    artworkUrl?: string;
}

/**
 * One catalog-capable plugin that could not be listed
 * generated from [CatalogSourceError](file://./../../../../../apps/api/data/contracts/playlists/playlists.types.ck#L34)
 */
export interface CatalogSourceError {
    pluginId: string;
    pluginName: string;
    message: string;
}

/**
 * generated from [CatalogPlaylist](file://./../../../../../apps/api/data/contracts/playlists/playlists.types.ck#L11)
 */
export interface CatalogPlaylist {
    pluginId: string;
    pluginName: string;
    id: string;
    name: string;
    description?: string;
    trackCount?: number;
    artworkUrl?: string;
    /** What the SOURCE permits on this playlist's items, not what this actor may do. Empty means the source permits nothing; absent means it did not say */
    permissions?: PlaylistPermission[];
}

/**
 * generated from [CatalogPlaylistTracks](file://./../../../../../apps/api/data/contracts/playlists/playlists.types.ck#L45)
 */
export interface CatalogPlaylistTracks {
    pluginId: string;
    playlistId: string;
    tracks: CatalogTrack[];
}

/**
 * generated from [CatalogPlaylistPage](file://./../../../../../apps/api/data/contracts/playlists/playlists.types.ck#L40)
 */
export interface CatalogPlaylistPage {
    playlists: CatalogPlaylist[];
    errors: CatalogSourceError[];
}
