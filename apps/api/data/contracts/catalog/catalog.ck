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
        # The floor for every operation in this file, cascading file -> route -> operation. Almost
        # everything here is a read, so the floor is the one `playout.ck` already uses:
        # `platform.view`, which both platform roles grant. The three rating verbs override it with
        # `platform.manage`, and they are the only operations here that do.
        #
        # Not `policy: none`. That spelling still requires a session, but it accepts ANY signed-in
        # actor, including one holding no platform role at all — which today is every account that
        # came in through `/auth/login/register`, since only onboarding writes a role tuple.
        policy: platform.view
    }
}

# The station's own catalog, as opposed to /playlists, which fans out to whatever the enabled
# plugins can offer right now. Reads are `platform.view` over canonical rows; the one thing an
# operator writes here is what the station thinks of them.

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

operation /catalog/artists/{id}/rating: {
    params: {
        id: uuid
    }
    put: { # What the station thinks of this artist. A dislike here excludes every record they are credited on
        name: Rate artist
        service: ArtistsService.rateArtist
        security: {
            # Reading the catalog is what a listener's console shows; rating something changes what
            # the station will play, and a dislike cannot be overridden by any programming. That is
            # an operator action, so it takes `platform.manage` rather than the file's read floor.
            policy: platform.manage
        }
        request: {
            application/json: RateInput
        }
        response: {
            200: {
                application/json: Artist
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
        query: TrackQuery
        response: {
            200: {
                application/json: TrackPage
            }
        }
    }
}

operation /catalog/albums/{id}/rating: {
    params: {
        id: uuid
    }
    put: { # What the station thinks of this record. A dislike here excludes every track on it
        name: Rate album
        service: AlbumsService.rateAlbum
        security: {
            # An operator action, for the reason the artist's rating is. See that one.
            policy: platform.manage
        }
        request: {
            application/json: RateInput
        }
        response: {
            200: {
                application/json: Album
            }
        }
    }
}

operation /catalog/tracks/{id}: {
    params: {
        id: uuid
    }
    get: { # One record and everything it has accumulated: its copies, its bytes, its measurement, what it has aired
        name: Get track
        service: TracksService.getTrack
        response: {
            200: {
                application/json: TrackDetail
            }
        }
    }
}

# ── throwing away what the station can work out again ──────────────────────────────────
#
# Four verbs, and every one of them removes something DERIVED: bytes that can be fetched again, a
# measurement that can be taken again, a provider's answer that can be asked for again. **Nothing
# here deletes a canonical row** — deleting a `tracks` row has merge semantics behind it and is a
# different feature that would say so.
#
# All `platform.manage`, because each one makes the station go and do work, and each is stamped on
# the activity feed with the actor who asked: a re-fetch or a re-measure that appeared from nowhere
# reads as the station churning for no reason.

operation /catalog/tracks/{id}/audio: {
    params: {
        id: uuid
    }
    delete: { # Drop the station's own copies of this record. The next play fetches them again
        name: Clear track audio
        service: TracksService.clearAudio
        security: {
            policy: platform.manage
        }
        response: {
            200: {
                application/json: TrackClearResult
            }
            # A record inside the committable window is REFUSED rather than queued: the director
            # commits on the audio being present, so taking the file would produce exactly the
            # silence the commit gate exists to prevent. The operator can skip it or take it out of
            # the running order, both of which they can do from the same console.
            409:
        }
    }
}

operation /catalog/tracks/{id}/analysis: {
    params: {
        id: uuid
    }
    delete: { # Forget the measurement, so the walk takes it again
        name: Clear track analysis
        service: TracksService.clearAnalysis
        security: {
            policy: platform.manage
        }
        response: {
            200: {
                application/json: TrackClearResult
            }
        }
    }
}

operation /catalog/tracks/{id}/retry: {
    params: {
        id: uuid
    }
    post: { # Try this record's copies again now, rather than when the backoff says
        name: Retry track audio
        service: TracksService.retryAudio
        security: {
            policy: platform.manage
        }
        response: {
            200: {
                application/json: TrackClearResult
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
    delete: { # Forget what the providers said, so the enrichment pass asks again
        name: Clear track enrichment
        service: TracksService.clearEnrichment
        query: ClearEnrichmentQuery
        security: {
            policy: platform.manage
        }
        response: {
            200: {
                application/json: TrackClearResult
            }
        }
    }
}

operation /catalog/tracks: {
    get: { # Every track, flat. The only way to answer "do we have this song?" without knowing its artist
        name: List tracks
        service: TracksService.listTracks
        query: TrackQuery
        response: {
            200: {
                application/json: TrackPage
            }
        }
    }
}

operation /catalog/tracks/{id}/rating: {
    params: {
        id: uuid
    }
    put: { # What the station thinks of this song, which is the narrowest thing an opinion can be about
        name: Rate track
        service: TracksService.rateTrack
        security: {
            # An operator action, for the reason the artist's rating is. See that one.
            policy: platform.manage
        }
        request: {
            application/json: RateInput
        }
        response: {
            200: {
                application/json: Track
            }
        }
    }
}
