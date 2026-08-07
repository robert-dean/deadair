options {
    keys: {
        area: catalog
    }
    services: {
        ArtistsService: "#src/modules/catalog/artists.service.js"
        AlbumsService: "#src/modules/catalog/albums.service.js"
        TracksService: "#src/modules/catalog/tracks.service.js"
        EnrichmentReadService: "#src/modules/enrichment/enrichment.read.service.js"
    }
    security: {
        # The floor for every operation in this file, cascading file -> route -> operation. The
        # catalog is entirely reads, so it sits on the read floor that `playout.ck` already uses:
        # `platform.view`, which both platform roles grant. Nothing here overrides it.
        #
        # Not `policy: none`. That spelling still requires a session, but it accepts ANY signed-in
        # actor, including one holding no platform role at all — which today is every account that
        # came in through `/auth/login/register`, since only onboarding writes a role tuple.
        policy: platform.view
    }
}

# The station's own catalog, as opposed to /playlists, which fans out to whatever the enabled
# plugins can offer right now. Everything here is a `platform.view` read of canonical rows.

operation /catalog/artists: {
    get: { # Every artist the station has ingested, ordered by name
        name: List artists
        service: ArtistsService.listArtists
        query: CatalogQuery
        response: {
            200: {
                application/json: ArtistPage
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
        response: {
            200: {
                application/json: Artist
            }
        }
    }
}

operation /catalog/artists/{id}/enrichment: {
    params: {
        id: uuid
    }
    get: { # What every enrichment provider said about this artist, and when each of them said it
        name: Get artist enrichment
        service: EnrichmentReadService.getArtistEnrichment
        response: {
            200: {
                application/json: ArtistEnrichmentDetail
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
        response: {
            200: {
                application/json: AlbumPage
            }
        }
    }
}

operation /catalog/albums: {
    get: {
        name: List albums
        service: AlbumsService.listAlbums
        query: CatalogQuery
        response: {
            200: {
                application/json: AlbumPage
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
        response: {
            200: {
                application/json: Album
            }
        }
    }
}

operation /catalog/albums/{id}/enrichment: {
    params: {
        id: uuid
    }
    get: { # The record's own enrichment: the label, pressing and cover belong to the release, not to a track on it
        name: Get album enrichment
        service: EnrichmentReadService.getAlbumEnrichment
        response: {
            200: {
                application/json: AlbumEnrichmentDetail
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
        response: {
            200: {
                application/json: TrackPage
            }
        }
    }
}

operation /catalog/tracks/{id}/enrichment: {
    params: {
        id: uuid
    }
    get: { # What the providers said about one recording, including everything no canonical column holds
        name: Get track enrichment
        service: EnrichmentReadService.getTrackEnrichment
        response: {
            200: {
                application/json: TrackEnrichmentDetail
            }
        }
    }
}

operation /catalog/tracks: {
    get: { # Every track, flat. The only way to answer "do we have this song?" without knowing its artist
        name: List tracks
        service: TracksService.listTracks
        query: CatalogQuery
        response: {
            200: {
                application/json: TrackPage
            }
        }
    }
}
