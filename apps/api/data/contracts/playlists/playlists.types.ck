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

# One record as its PROVIDER describes it, plus what the catalog can say about the same copy.
#
# The first half mirrors the plugin SDK's `ProviderTrack` and stays the provider's answer: this is a
# listing of what a playlist holds, not of what the station has ingested. The three ids below are the
# station's own and are absent for anything it has never seen, which on most playlists is plenty of
# rows — a playlist is a provider's list and the library is what a sync has walked
contract CatalogTrack: {
    id: string(min=1, max=400) # The PROVIDER's id for this copy, which is what an import names it by. Never a `deadair.tracks` id
    title: string(min=1, max=400)
    artists: array(string(min=1, max=200)) # Ordered, primary artist first. Empty array if the provider genuinely has none
    album?: string(max=400)
    durationMs?: int(min=0)
    isrc?: string(max=100)
    artworkUrl?: string(max=2000)
    trackId?: string(max=100) # The canonical `deadair.tracks` row this copy is bound to, when the catalog holds one
    artistId?: string(max=100) # The canonical artist behind that row
    albumId?: string(max=100) # The release that row was ingested inside. Absent for a single ingested outside any
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
