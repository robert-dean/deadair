options {
    keys: {
        area: music
    }
    services: {
        ArtistsService: "#src/modules/catalog/artists.service.js"
        AlbumsService: "#src/modules/catalog/albums.service.js"
        TracksService: "#src/modules/catalog/tracks.service.js"
    }
}

operation /music/artists: {
    get: {
        name: List artists
        service: ArtistsService.listArtists
        query: Pagination
        security: none
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

operation /music/albums: {
    get: {
        name: List albums
        service: AlbumsService.listAlbums
        query: Pagination
        security: none
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

operation /music/tracks: {
    get: {
        name: List tracks
        service: TracksService.listTracks
        query: Pagination
        security: none
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