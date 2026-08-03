/**
 * A playlist a catalog-capable plugin offers, tagged with the plugin it came from so an aggregated list is addressable
 * generated from [CatalogPlaylist](file://./../../../../../apps/api/data/contracts/playlists/playlists.types.ck#L8)
 */
export interface CatalogPlaylist {
    pluginId: string;
    pluginName: string;
    id: string;
    name: string;
    description?: string;
    trackCount?: number;
    artworkUrl?: string;
}

/**
 * Mirrors the plugin SDK's `ProviderTrack`
 * generated from [CatalogTrack](file://./../../../../../apps/api/data/contracts/playlists/playlists.types.ck#L19)
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
 * generated from [CatalogSourceError](file://./../../../../../apps/api/data/contracts/playlists/playlists.types.ck#L30)
 */
export interface CatalogSourceError {
    pluginId: string;
    pluginName: string;
    message: string;
}

/**
 * generated from [CatalogPlaylistTracks](file://./../../../../../apps/api/data/contracts/playlists/playlists.types.ck#L41)
 */
export interface CatalogPlaylistTracks {
    pluginId: string;
    playlistId: string;
    tracks: CatalogTrack[];
}

/**
 * generated from [CatalogPlaylistPage](file://./../../../../../apps/api/data/contracts/playlists/playlists.types.ck#L36)
 */
export interface CatalogPlaylistPage {
    playlists: CatalogPlaylist[];
    errors: CatalogSourceError[];
}
