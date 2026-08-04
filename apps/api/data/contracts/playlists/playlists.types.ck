options {
    keys: {
        area: playlists
    }
}

# A playlist a catalog-capable plugin offers, tagged with the plugin it came from so an aggregated list is addressable
contract CatalogPlaylist: {
    pluginId: string(min=1, max=200)
    pluginName: string(min=1, max=200)
    id: string(min=1, max=400)
    name: string(min=1, max=200)
    description?: string(max=2000)
    trackCount?: number
    artworkUrl?: string(max=2000)
    importable?: boolean # False when the source will list this playlist but refuse its tracks, so importing it cannot succeed. Absent means no reason to think otherwise
}

# Mirrors the plugin SDK's `ProviderTrack`
contract CatalogTrack: {
    id: string(min=1, max=400)
    title: string(min=1, max=400)
    artists: array(string(min=1, max=200)) # Ordered, primary artist first. Empty array if the provider genuinely has none
    album?: string(max=400)
    durationMs?: number
    isrc?: string(max=100)
    artworkUrl?: string(max=2000)
}

# One catalog-capable plugin that could not be listed
contract CatalogSourceError: {
    pluginId: string(min=1, max=200)
    pluginName: string(min=1, max=200)
    message: string(max=4000)
}

contract CatalogPlaylistPage: {
    playlists: array(CatalogPlaylist)
    errors: array(CatalogSourceError)
}

contract CatalogPlaylistTracks: {
    pluginId: string(min=1, max=200)
    playlistId: string(min=1, max=400)
    tracks: array(CatalogTrack)
}
