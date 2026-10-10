options {
    keys: {
        area: nowplaying
    }
    services: {
        NowPlayingService: "#src/modules/nowplaying/nowplaying.service.js"
        LyricsReadService: "#src/modules/lyrics/lyrics.read.service.js"
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
        mcp: {
            description: "What is on air right now: the record, its artist and album, and when it started. Answers onAir: false when the station is quiet, which is an answer rather than an error. Use this when asked what is playing; use get_playout_status for what is queued behind it."
        }
        response: {
            200: {
                application/json: NowPlaying
            }
        }
    }
}

operation /nowplaying/lyrics: {
    get: { # The words of the record on air, with what a player needs to follow along line by line
        name: Get now playing lyrics
        # Kept off the MCP surface for the reason the catalog's lyrics routes are: a model that can
        # read a lyric can recite it.
        mcp: exclude
        service: LyricsReadService.getNowPlayingLyrics
        security: {
            # NOT public, unlike `/nowplaying` above. What is on air is audible to anyone listening;
            # the words are somebody's copyrighted text, so they take the catalog's read floor. The
            # CORS opening and the transaction exemption both name `/nowplaying` exactly, so neither
            # reaches this route, and this route reads the database.
            policy: platform.view
        }
        response: {
            200: {
                application/json: NowPlayingLyrics
            }
        }
    }
}
