options {
    keys: {
        area: narrations
    }
    services: {
        NarrationsService: "#src/modules/narrations/narrations.service.js"
    }
    security: {
        # The floor for the file is the reads, which fan out to plugins or read the station's own
        # table on behalf of the console, on the `platform.view` floor the podcasts page uses. Asking
        # for a refresh or a render is an operator action and says so on its own verb.
        policy: platform.view
    }
}

# What the station can read out, out of whatever narration plugins are installed, and the pieces of
# each it knows about. Nothing here schedules or airs anything: a clock band does that.

operation /narrations/series: {
    get: { # Every series every installed narration plugin offers
        name: List series
        service: NarrationsService.readSeries
        response: {
            200: {
                application/json: StationSeriesList
            }
        }
    }
}

operation /narrations/pieces: {
    get: { # The pieces the station knows about, in their series' own order, with what it has done with each
        name: List pieces
        service: NarrationsService.readPieces
        query: StationPieceQuery
        response: {
            200: {
                application/json: StationPiecePage
            }
        }
    }
}

operation /narrations/pieces/{id}/render: {
    params: {
        id: string(min=1, max=100)
    }
    post: { # Has one piece spoken now, rather than waiting for its slot to come near
        name: Render piece
        service: NarrationsService.requestRender
        security: {
            # An operator action, and an expensive one: it spends the station's only speech engine on
            # a whole chapter, which is minutes of it.
            policy: platform.manage
        }
        response: {
            200: {
                application/json: StationPiece
            }
        }
    }
}

operation /narrations/refresh: {
    post: { # Reads every series again, in the background, rather than waiting for the next scheduled refresh
        name: Refresh narrations
        service: NarrationsService.requestRefresh
        security: {
            # An operator action: it spends requests against every source on the list.
            policy: platform.manage
        }
    }
}
