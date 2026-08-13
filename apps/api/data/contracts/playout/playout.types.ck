options {
    keys: {
        area: playout
    }
}

contract PlayoutPlaylistInput: { # The plugin playlist to load into the running order
    pluginId: string(min=1, max=200)
    playlistId: string(min=1, max=400)
}

contract PlayoutItem: { # One item in the running order, as the console sees it
    id: string(min=1, max=100) # deadair's own id for this item, not the provider's: a playlist may hold the same track twice
    pluginId: string(min=1, max=200)
    externalId: string(min=1, max=400) # The track's id in its plugin's id space
    title: string(min=1, max=400)
    artists: array(string(min=1, max=200))
    durationMs?: int(min=0) # Integer milliseconds. Deliberately not the `duration` scalar, which is a Luxon `Duration` over an ISO-8601 string
    album?: string(max=400)
    artworkUrl?: string(max=2000) # The locally cached cover where there is one, the provider's URL otherwise
    year?: int(min=0) # First release year, when the catalog knows one
    trackId?: string(max=100) # The canonical `deadair.tracks` id, when this item is a track the catalog holds. Absent for anything the catalog has never seen
}

contract PlayoutNowPlaying: { # What the PLAYER says is airing, which is not the same as what was last handed to it
    item: PlayoutItem
    startedAt: int(min=0) # Unix epoch millis, as observed when the player reported it
    remainingMs?: int(min=0) # The decoder's own countdown, absent when it cannot say. It leads the listener by the encoder and client buffers
}

# A stream container still running config the app has replaced. Icecast and Liquidsoap read
# their rendered config ONCE, at startup, and nothing restarts or signals them when it is
# re-rendered — so a reseeded secret leaves a process holding credentials that match nothing,
# and the symptom names something else entirely (every listener refused, or no mount at all).
# The app cannot restart a sibling container and should not be able to, so it reports.
contract StreamConfigWarning: {
    container: enum(icecast, liquidsoap) # Which one is behind
    detail: string(min=1, max=1000) # What is wrong and how it is known, in a sentence
    restart: string(min=1, max=200) # The exact command that adopts the new config, which is the only thing that does
}

# Which gate is keeping the station quiet, or `airing` when none of them is. Ordered by cause: a
# stalled transport loop makes every reading under it stale, so it is ruled out first
contract SilenceCause: enum(
    airing,
    transportStalled,
    controlDenied,
    streamUnreachable,
    configNotAdopted,
    stoodDown,
    noProgramme,
    audienceUnknown,
    noAudience,
    notDriving,
    starved
)

# How one gate is doing. `waiting` is its own state rather than a mild fault, because a station
# idling for want of a listener and a station that cannot reach its stream are both silent and only
# one of them is something to go and fix
contract SilenceState: enum(ok, waiting, fault)

contract SilenceCheck: { # One gate's answer about itself
    code: SilenceCause # Never `airing`, which is the absence of a blocking gate rather than a gate
    state: SilenceState
    detail: string(min=1, max=1000) # What this gate is doing right now, whether or not it is the one blocking
    remedy?: string(max=500) # What would clear it, where there is something an operator can actually do
}

contract StationSilence: { # Why the station cannot be heard, as one answer
    audible: boolean # Whether the station believes its programme is reaching the mount. NOT whether anybody is hearing it: a station can be audible with no listeners in `always` mode, and can have listeners while airing the local bed
    cause: SilenceCause
    detail: string(min=1, max=1000)
    remedy?: string(max=500)
    checks: array(SilenceCheck) # Every gate, in the order they are judged, so a console can say what it ruled out. A `configNotAdopted` fault appears here and is never the cause, because a station can air perfectly well while it is true
}

contract PlayoutStatus: { # The station's transport, as one reading
    streamUp: boolean # Whether Liquidsoap's control API is answering at all. False means nothing can air, whatever the running order holds
    onAir: boolean # Whether the station is actually broadcasting. deadair holds the mount on a lease it renews only while it has a programme, so a reachable stream with nothing to play is up and NOT on air: it is connected, and airing silence
    mountPath: string(min=1, max=200) # Same-origin path of the Icecast mount, for a console that wants to monitor what it is driving. A path rather than a URL: the browser reaches Icecast through whatever edge served the SPA, never at the address the app itself uses
    nowPlaying?: PlayoutNowPlaying
    upNext: array(PlayoutItem) # Waiting here, in order. Excludes what the player already holds
    queuedCount: int(min=0) # How many items are waiting in total, of which `upNext` is the head
    listeners: int(min=0) # How many clients Icecast has attached to the mount. Zero both for "nobody is listening" and for an Icecast that is not answering, which `audience` is where to tell apart
    audience: boolean # Whether the station counts as having an audience, which lingers for a minute past the last listener so a reconnecting player does not cut the broadcast
    staleStreamConfig: array(StreamConfigWarning) # Containers running config the app has since replaced. Empty is the ordinary state, and so is empty for anything the app has no evidence about: a warning here has never been a guess
    silence: StationSilence # Which gate is keeping the station quiet, composed from every one of them rather than inferred from the fields above. `streamUp`, `onAir`, `audience` and `queuedCount` each answer for one gate and a console reading them alone has to guess at the rest
}

contract PlayoutAiredQuery: { # Which rundown item Liquidsoap has just started playing
    item: string(min=1, max=100) # The id the app put on the pushed uri's `annotate:` metadata
}

contract PlayoutListenerQuery: { # Which way a listener went
    event: enum(add, remove)
}

contract PlayoutStarveQuery: { # Which way the running order went, and how long it had been that way
    state: enum(starved, recovered) # `starved`: the queue stopped producing while deadair was driving, so the mount fell through to the local bed. `recovered`: it is producing again
    forMs: int(min=0) # How long the PREVIOUS state lasted, in milliseconds. On a recovery this is the length of the gap, which is the number worth reading
}
