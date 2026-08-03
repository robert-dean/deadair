options {
    keys: {
        area: playlists
    }
    services: {
        PlaylistsService: "#src/modules/playlists/playlists.service.js"
    }
}

operation /playlists: {
    get: { # Fans out across every installed plugin that declares AND implements the `catalog` capability
        name: List importable playlists
        service: PlaylistsService.listPlaylists
        security: {
            policy: none
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
            policy: none
        }
        response: {
            200: {
                application/json: CatalogPlaylistTracks
            }
        }
    }
}
