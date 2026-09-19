options {
    keys: {
        area: playlists
    }
    services: {
        PlaylistsService: "#src/modules/playlists/playlists.service.js"
    }
    security: {
        # The floor is the WRITE end, as in the topics, the schedule and the personas: hiding a
        # playlist changes what every picker on the station offers and what the library sync reads,
        # so a route added here without a block of its own inherits the tighter gate, which is the
        # failure that gets reported rather than the one that goes quiet. The two reads override it
        # downward.
        policy: platform.manage
    }
}

operation /playlists: {
    get: { # Fans out across every installed plugin that declares AND implements the `catalog` capability
        name: List importable playlists
        service: PlaylistsService.listPlaylists
        security: {
            # A read that fans out to plugins on behalf of the console, on the same floor as the
            # catalog and the playout status.
            policy: platform.view
        }
        response: {
            200: {
                application/json: CatalogPlaylistPage
            }
        }
    }
}

operation /playlists/{pluginId}/{playlistId}/tracks: {
    params: {
        pluginId: string(min=1, max=200)
        playlistId: string(min=1, max=400)
    }
    get: { # One playlist's tracks from one plugin
        name: Get playlist tracks
        service: PlaylistsService.getPlaylistTracks
        security: {
            # A read, on the listing's floor.
            policy: platform.view
        }
        response: {
            200: {
                application/json: CatalogPlaylistTracks
            }
        }
    }
}

operation /playlists/{pluginId}/{playlistId}/hidden: {
    params: {
        pluginId: string(min=1, max=200)
        playlistId: string(min=1, max=400)
    }
    put: { # Hides one playlist from this station: the listing marks it hidden, the pickers stop offering it and the library sync stops reading it. Hiding one already hidden changes nothing
        name: Hide playlist
        service: PlaylistsService.hidePlaylist
    }
    delete: { # Shows a hidden playlist again. Showing one that is not hidden changes nothing
        name: Show playlist
        service: PlaylistsService.showPlaylist
    }
}

operation /playlists/refresh: {
    post: { # Reads every playlist on every music source again, in the background, rather than waiting for the next scheduled read. New records reach the library; records gone from every playlist are retired
        name: Refresh playlists
        service: PlaylistsService.requestRefresh
    }
}

operation /playlists/{pluginId}/{playlistId}/refresh: {
    params: {
        pluginId: string(min=1, max=200)
        playlistId: string(min=1, max=400)
    }
    post: { # Reads one playlist again, in the background. New records reach the library; a record taken out of it stays until the next full read judges it
        name: Refresh playlist
        service: PlaylistsService.requestPlaylistRefresh
    }
}
