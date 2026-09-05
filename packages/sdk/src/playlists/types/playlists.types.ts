/**
 * An action a source will permit on one playlist's items. Item-scoped: neither value covers the playlist's own name or description
 * generated from [PlaylistPermission](../../../../../apps/api/data/contracts/playlists/playlists.types.ck#L8)
 */
export type PlaylistPermission = 'read' | 'edit';

/**
 * One record as its PROVIDER describes it, plus what the catalog can say about the same copy.
 *
 * The first half mirrors the plugin SDK's `ProviderTrack` and stays the provider's answer: this is a
 * listing of what a playlist holds, not of what the station has ingested. The three ids below are the
 * station's own and are absent for anything it has never seen, which on most playlists is plenty of
 * rows — a playlist is a provider's list and the library is what a sync has walked
 * generated from [CatalogTrack](../../../../../apps/api/data/contracts/playlists/playlists.types.ck#L28)
 */
export interface CatalogTrack {
    /** The PROVIDER's id for this copy, which is what an import names it by. Never a `deadair.tracks` id */
    id: string;
    title: string;
    /** Ordered, primary artist first. Empty array if the provider genuinely has none */
    artists: string[];
    album?: string;
    durationMs?: number;
    isrc?: string;
    artworkUrl?: string;
    /** The canonical `deadair.tracks` row this copy is bound to, when the catalog holds one */
    trackId?: string;
    /** The canonical artist behind that row */
    artistId?: string;
    /** The release that row was ingested inside. Absent for a single ingested outside any */
    albumId?: string;
}

/**
 * One catalog-capable plugin that could not be listed
 * generated from [CatalogSourceError](../../../../../apps/api/data/contracts/playlists/playlists.types.ck#L42)
 */
export interface CatalogSourceError {
    pluginId: string;
    pluginName: string;
    message: string;
}

/**
 * A playlist a catalog-capable plugin offers, tagged with the plugin it came from so an aggregated list is addressable
 * generated from [CatalogPlaylist](../../../../../apps/api/data/contracts/playlists/playlists.types.ck#L11)
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
 * generated from [CatalogPlaylistTracks](../../../../../apps/api/data/contracts/playlists/playlists.types.ck#L53)
 */
export interface CatalogPlaylistTracks {
    pluginId: string;
    playlistId: string;
    tracks: CatalogTrack[];
}

/**
 * generated from [CatalogPlaylistPage](../../../../../apps/api/data/contracts/playlists/playlists.types.ck#L48)
 */
export interface CatalogPlaylistPage {
    playlists: CatalogPlaylist[];
    errors: CatalogSourceError[];
}
