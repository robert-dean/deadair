options {
    keys: {
        area: playlists
    }
    services: {
        StationPlaylistsService: "#src/modules/playlists/station.playlists.service.js"
        PlaylistImportService: "#src/modules/playlists/playlist.import.service.js"
    }
    security: {
        # The floor is the WRITE end, as in playlists.ck: an import writes to the library's playlists
        # and a delete removes one. The reads override it downward.
        policy: platform.manage
    }
}

operation /station-playlists: {
    get: { # Every playlist the station owns, newest first
        name: List station playlists
        service: StationPlaylistsService.list
        security: {
            policy: platform.view
        }
        response: {
            200: {
                application/json: StationPlaylistList
            }
        }
    }
}

operation /station-playlists/{id}: {
    params: {
        id: uuid
    }
    get: { # One station playlist with its records in order, placeholders included
        name: Get station playlist
        service: StationPlaylistsService.get
        security: {
            policy: platform.view
        }
        response: {
            200: {
                application/json: StationPlaylistDetail
            }
            404:
        }
    }
    patch: { # Renames a station playlist, or rewrites what it is for
        name: Update station playlist
        service: StationPlaylistsService.update
        request: {
            application/json: StationPlaylistUpdate
        }
        response: {
            200: {
                application/json: StationPlaylist
            }
            404:
        }
    }
    delete: { # Deletes a station playlist. The records it named stay in the library
        name: Delete station playlist
        service: StationPlaylistsService.delete
        response: {
            204:
            404:
        }
    }
}

operation /station-playlists/{id}/fill: {
    params: {
        id: uuid
    }
    post: { # Looks up the records this playlist names and the library does not hold, in the background, and adds the ones a provider has. The activity feed says how it went
        name: Fill station playlist
        service: StationPlaylistsService.requestFill
        response: {
            202:
            404:
        }
    }
}

operation /station-playlists/{id}/export: {
    params: {
        id: uuid
    }
    get: { # One station playlist as a file another station can import
        name: Export station playlist
        service: StationPlaylistsService.export
        security: {
            policy: platform.view
        }
        response: {
            200: {
                application/json: PlaylistFile
                headers: {
                    Content-Disposition?: string
                }
            }
            404:
        }
    }
}

# What an import would do, from the same planner the import runs, so a console can preview the moment
# a source is chosen and offer Import as a second, deliberate act.
operation /station-playlists/import/preview: {
    post: { # Reads a source and reports which of its records the library holds and which it would have to find. Writes nothing
        name: Preview playlist import
        service: PlaylistImportService.preview
        request: {
            application/json: PlaylistImportInput
        }
        response: {
            200: {
                application/json: PlaylistImportPlan
            }
        }
    }
}

# A clone, never a merge: importing the same source twice makes two playlists, as 0005 says. Every
# record becomes a row, and one the library does not hold is kept as a placeholder in its place.
operation /station-playlists/import: {
    post: { # Makes a new station playlist from a source and answers with what it did
        name: Import playlist
        service: PlaylistImportService.import
        request: {
            application/json: PlaylistImportInput
        }
        response: {
            200: {
                application/json: PlaylistImportResult
            }
        }
    }
}
