options {
    keys: {
        area: playlists
    }
}

# An action a source will permit on one playlist's items. Item-scoped: neither value covers the playlist's own name or description
contract PlaylistPermission: enum(read, edit)

# A playlist a catalog-capable plugin offers, tagged with the plugin it came from so an aggregated list is addressable
contract CatalogPlaylist: {
    pluginId: string(min=1, max=200)
    pluginName: string(min=1, max=200)
    id: string(min=1, max=400)
    name: string(min=1, max=200)
    description?: string(max=2000)
    trackCount?: int(min=0)
    artworkUrl?: string(max=2000)
    permissions?: array(PlaylistPermission) # What the SOURCE permits on this playlist's items, not what this actor may do. Empty means the source permits nothing; absent means it did not say
}

# Mirrors the plugin SDK's `ProviderTrack`
contract CatalogTrack: {
    id: string(min=1, max=400)
    title: string(min=1, max=400)
    artists: array(string(min=1, max=200)) # Ordered, primary artist first. Empty array if the provider genuinely has none
    album?: string(max=400)
    durationMs?: int(min=0)
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
