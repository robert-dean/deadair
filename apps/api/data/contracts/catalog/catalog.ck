options {
    keys: {
        area: catalog
    }
    services: {
        ArtistsService: "#src/modules/catalog/artists.service.js"
        AlbumsService: "#src/modules/catalog/albums.service.js"
        TracksService: "#src/modules/catalog/tracks.service.js"
    }
}

# The station's own catalog, as opposed to /playlists, which fans out to whatever the enabled
# plugins can offer right now. Everything here is a session-gated read of canonical rows.

operation /catalog/artists: {
    get: { # Every artist the station has ingested, ordered by name
        name: List artists
        service: ArtistsService.listArtists
        query: CatalogQuery
        security: {
            policy: none
        }
        response: {
            200: {
                application/json: {
                    meta: Pagination
                    data: array(Artist)
                }
            }
        }
    }
}

operation /catalog/artists/{id}: {
    params: {
        id: uuid
    }
    get: { # One artist. 404s on an id that was merged away, since reads never return merged rows
        name: Get artist
        service: ArtistsService.getArtist
        security: {
            policy: none
        }
        response: {
            200: {
                application/json: Artist
            }
        }
    }
}

operation /catalog/artists/{id}/albums: {
    params: {
        id: uuid
    }
    get: { # The albums credited to one artist
        name: List artist albums
        service: AlbumsService.listAlbumsByArtist
        query: CatalogQuery
        security: {
            policy: none
        }
        response: {
            200: {
                application/json: {
                    meta: Pagination
                    data: array(Album)
                }
            }
        }
    }
}

operation /catalog/albums: {
    get: {
        name: List albums
        service: AlbumsService.listAlbums
        query: CatalogQuery
        security: {
            policy: none
        }
        response: {
            200: {
                application/json: {
                    meta: Pagination
                    data: array(Album)
                }
            }
        }
    }
}

operation /catalog/albums/{id}: {
    params: {
        id: uuid
    }
    get: {
        name: Get album
        service: AlbumsService.getAlbum
        security: {
            policy: none
        }
        response: {
            200: {
                application/json: Album
            }
        }
    }
}

operation /catalog/albums/{id}/tracks: {
    params: {
        id: uuid
    }
    get: { # One album's tracks
        name: List album tracks
        service: TracksService.listTracksByAlbum
        query: CatalogQuery
        security: {
            policy: none
        }
        response: {
            200: {
                application/json: {
                    meta: Pagination
                    data: array(Track)
                }
            }
        }
    }
}

operation /catalog/tracks: {
    get: { # Every track, flat. The only way to answer "do we have this song?" without knowing its artist
        name: List tracks
        service: TracksService.listTracks
        query: CatalogQuery
        security: {
            policy: none
        }
        response: {
            200: {
                application/json: {
                    meta: Pagination
                    data: array(Track)
                }
            }
        }
    }
}
