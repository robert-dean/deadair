options {
    keys: {
        area: playlists
    }
    services: {
        PlaylistsService: "#src/modules/playlists/playlists.service.js"
    }
    security: {
        # The floor for both operations in this file, cascading file -> route -> operation. Both
        # are reads that fan out to plugins on behalf of the console, so they sit on the same
        # `platform.view` read floor as the catalog and the playout status. Nothing overrides it.
        policy: platform.view
    }
}

operation /playlists: {
    get: { # Fans out across every installed plugin that declares AND implements the `catalog` capability
        name: List importable playlists
        service: PlaylistsService.listPlaylists
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
        response: {
            200: {
                application/json: CatalogPlaylistTracks
            }
        }
    }
}
