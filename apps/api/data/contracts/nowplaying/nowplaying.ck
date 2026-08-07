options {
    keys: {
        area: nowplaying
    }
    services: {
        NowPlayingService: "#src/modules/nowplaying/nowplaying.service.js"
    }
}

# ── What the station is playing ────────────────────────────────────────────────────────
#
# The one deliberately public route in the app. A player, a hi-fi streamer or a station
# page has to be able to ask what is on air without holding a session, and there is
# nothing here worth gating: it says what anyone listening to the mount can already hear.
#
# `security: none` on the operation rather than a file floor, so a second route added
# here has to make the same decision out loud instead of inheriting it.

operation /nowplaying: {
    get: { # What is on air right now. Answers 200 with `onAir: false` when the station is quiet, so a device polling this treats silence as an answer rather than an error
        name: Get now playing
        service: NowPlayingService.getNowPlaying
        security: none
        response: {
            200: {
                application/json: NowPlaying
            }
        }
    }
}
