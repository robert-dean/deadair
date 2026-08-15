options {
    keys: {
        area: director
    }
}

# What kind of programming the station is running, which decides the rules it runs under
contract StationMode: enum(rotation, setlist, feature)

# What the mount lease is renewed against: `audience` airs only while somebody is listening, `always` airs whenever there is a programme
contract AirMode: enum(audience, always)

contract StationAir: { # What the station is airing, and whether it is driving at all
    active: boolean # False means the station was stood down. What it was playing is remembered so the console can still say what it was
    airMode: AirMode # What puts the station on air. In `audience` mode a station that is active with a full running order is still silent while nobody is connected, which is the intended state and not a fault
    name?: string(max=200) # What is on. Absent before the station has ever been given anything to play
    source?: string(max=50) # Who built what is on: `import` or `director`
    remaining: int(min=0) # Items left before the running order runs out and `onEnd` decides what happens
}

contract SetStationAirInput: { # Change how the station decides to be on air
    airMode: AirMode
}

# What the station does when the running order runs out
contract StationOnEnd: enum(extend, repeat, stop)

# Where an item of the running order has got to. `handed` is a promise and `airing` is a fact, which is the distinction everything here is built around. The three terminal states that are not `played` are three different facts on a page that has to say why the station is silent: `skipped` is the station passing over an item it reached, `removed` is an operator taking one out before its turn, and `unavailable` is a record the station could not obtain the audio for — the only one of the three an operator can act on, since it names a copy rather than a decision
contract StationItemState: enum(planned, handed, airing, played, skipped, unavailable, removed)

contract StationOrderItem: { # One item of the live running order, and where it has got to
    id: string(min=1, max=100) # What an edit names, what rides through the player, and what comes back on its readings
    kind: enum(track, segment) # Whether this is a record or something the station says: an ident, a stinger, a talk break
    state: StationItemState
    title: string(min=1, max=400) # The record's title, or the segment's label. What the mount is labelled with while it airs
    artists: array(string(min=1, max=200)) # Empty for a segment, which has no artist
    durationMs?: int(min=0)
    pluginId?: string(min=1, max=200) # Absent on a segment: the station serves its own audio
    externalId?: string(min=1, max=400) # Absent on a segment
    album?: string(max=400)
    artworkUrl?: string(max=2000)
    year?: int(min=0)
    trackId?: string(max=100) # The canonical catalog track, when this is one the catalog holds
    rating?: Rating # What the station thinks of this record, read as the order is drawn rather than stored on it. Absent on a segment, and on a record the catalog has never seen
    segmentId?: string(min=1, max=100) # Which segment this plays. Present only on a segment
    segmentState?: enum(planned, writing, written, rendering, ready, failed, gone)
    playable?: boolean # Whether the station can actually air this segment. One that cannot is SKIPPED when it comes round, rather than held open
    segmentError?: string(max=2000) # Why this segment will not air, in a sentence. Present only on a failed one
    segmentWriter?: string(max=200) # What decided the words: the station's own templates, or the model that wrote them. Absent on a recording somebody made
    overAtMs?: int(min=0) # Heard OVER the record that follows, this far into it, with the music ducked under it. Such an item is never handed to the player in its own right
}

contract StationOrder: { # The station's live running order: what is airing, item by item
    name: string(max=200) # What is on, for a console to draw. A label for this broadcast rather than the name of a stored object
    brief?: string(max=500) # What the operator asked the station to play, in their own words. It keeps steering every refill until the station is put on air again, so a console should show it rather than only accept it
    personaId?: string(max=100) # Who is hosting this broadcast, when it named somebody. Absent means whichever persona the station has on air
    personaLabel?: string(max=200) # What that host is called, resolved as the order is read so a console need not fetch the persona list to draw a name
    mode: StationMode
    onEnd: StationOnEnd
    source: string(min=1, max=50) # Who built it: `import` or `director`
    sourcePluginId?: string(max=200) # Where more material is pulled from, when it came from a playlist
    sourcePlaylistId?: string(max=400)
    items: array(StationOrderItem)
}

contract PutOnAirInput: { # Put the station on air, building its running order from the top
    pluginId?: string(min=1, max=200) # The plugin whose playlist to build from. Absent starts empty and lets the station generate its own programming
    playlistId?: string(min=1, max=400) # Required alongside `pluginId`. The playlist is READ at this moment rather than copied, so it is never edited by having been aired
    name?: string(min=1, max=200) # What to call this broadcast. Absent names it after the plugin, since only the surface that listed the playlist knows its own name for it
    brief?: string(max=500) # What the station should play, in your own words: "heavy metal hits". It steers every refill for as long as this broadcast runs, not just the first batch, and it needs a model to programme with. Absent programmes the station the way its own rules do
    personaId?: string(min=1, max=100) # Who is hosting this broadcast. It rides the running order for as long as the broadcast does, so the presenter cannot drift back mid-show. Absent uses whichever persona the station has on air
    mode?: StationMode
    onEnd?: StationOnEnd
}

contract AddStationSegmentInput: { # Put something the station says into the running order
    segmentId: string(min=1, max=100)
    atIndex?: int(min=0) # Where to put it. Absent puts it at the end. A position already handed to the player is refused
    overAtMs?: int(min=0, max=600000) # Play it OVER the record that follows, this far into it, rather than in the gap before it. Absent plays it between two records, which is the simpler path
}

contract MoveStationItemInput: { # Move an item within the running order
    toIndex: int(min=0)
}

contract ExtendStationInput: { # Add tracks to the running order now, rather than waiting for it to run short
    count?: int(min=1, max=100)
}
