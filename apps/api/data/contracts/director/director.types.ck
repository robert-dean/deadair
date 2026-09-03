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
    slotId?: string(max=100) # Which slot of the schedule this broadcast belongs to. Absent means nothing scheduled it, which is every station with no schedule
    airSource: AirSource # Who is driving the station right now
    held: boolean # Whether the schedule has been told to leave this broadcast alone. A takeover is otherwise replaced when the block it started inside ends
    holdUntil?: string(min=24, max=24) # When that hold lapses, as an ISO-8601 instant. ABSENT WHILE `held` IS TRUE means until it is released by hand, which is a real state rather than a missing value — `Infinity` is not a thing JSON can carry, so the two facts are two fields
}

contract AirSource: enum(off, schedule, sustaining, operator) # Who chose what is on air. `schedule` is a block the clock changed over to and `sustaining` is what it plays in the hours no block claims — both are the schedule driving. `operator` is a person, including one who took over inside a scheduled block, and it holds until the next block begins. `off` is a station stood down

contract HoldStationInput: { # How long to keep the schedule off the running order
    minutes?: int(min=1, max=1440) # How long the hold lasts, from now. ABSENT means until it is released by hand, which is the answer for an operator who does not know yet — a day is the ceiling because a hold nobody remembers setting is worse than one that lapses
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
    artistId?: string(max=100) # The canonical artist behind that track, so a console can reach their page from the running order. Absent on a segment, and on a record the catalog has never seen
    albumId?: string(max=100) # The release that track was ingested inside. Absent for the two reasons above and for a third: a single ingested outside any release has none
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
    source: string(min=1, max=50) # Who built it: `import`, `chart` or `director`
    sourcePluginId?: string(max=200) # Where more material is pulled from, when it came from a playlist
    sourcePlaylistId?: string(max=400)
    sourceChartId?: string(max=400) # The published chart this broadcast was built from, qualified with the plugin that offered it. Provenance rather than a binding: a chart is a fixed document, so it is read once and never topped up from
    items: array(StationOrderItem)
}

contract PutOnAirInput: { # Put the station on air, building its running order from the top
    pluginId?: string(min=1, max=200) # The plugin whose playlist to build from. Absent starts empty and lets the station generate its own programming
    playlistId?: string(min=1, max=400) # Required alongside `pluginId`. The playlist is READ at this moment rather than copied, so it is never edited by having been aired
    chartId?: string(min=1, max=400) # A published chart to build from instead, as `pluginId:chartId`. An ALTERNATIVE to `pluginId` and `playlistId` rather than a companion: a chart names records where a playlist names copies, so its entries are looked up and ingested before they can air, and a station with `rotation.discover` off can play almost none of one
    chartOrder?: enum(countdown, ranked, unordered) # Which way round to play it. `countdown` opens on the lowest rank and ends on number one, which is the shape a chart show has; `ranked` walks the published document from the top; `unordered` leaves the sequence to the station's own artist spacing. Absent is `countdown`. Ignored without `chartId`
    name?: string(min=1, max=200) # What to call this broadcast. Absent names it after the chart, or after the plugin, since only the surface that listed the source knows its own name for it
    brief?: string(max=500) # What the station should play, in your own words: "heavy metal hits". It steers every refill for as long as this broadcast runs, not just the first batch, and it needs a model to programme with. Absent programmes the station the way its own rules do
    personaId?: string(min=1, max=100) # Who is hosting this broadcast. It rides the running order for as long as the broadcast does, so the presenter cannot drift back mid-show. Absent uses whichever persona the station has on air
    eraFrom?: int(min=1900, max=2100) # The earliest release year this broadcast plays. Absent means no lower bound, and a record whose year the catalog does not know is played whatever the period
    eraTo?: int(min=1900, max=2100) # The latest release year, on the same terms. Set with `eraFrom` for a decade; either may stand alone
    callins?: boolean # Whether somebody phones in during this broadcast. A call is a short programme rather than a break: a few turns in a few voices, entering the running order as one block, spaced by `rotation.callinEveryMinutes`. Absent takes the station's own setting, which is off
    mode?: StationMode
    onEnd?: StationOnEnd
}

contract SetStationHostInput: { # Change who is presenting the broadcast that is on air
    personaId?: string(min=1, max=100) # Who hosts it from here on. Absent hands it back to whichever persona the station has on air, which is what a broadcast that never named one already does
}

contract AddStationSegmentInput: { # Put something the station says into the running order
    segmentId: string(min=1, max=100)
    atIndex?: int(min=0) # Where to put it. Absent puts it at the end. A position already handed to the player is refused
    overAtMs?: int(min=0, max=600000) # Play it OVER the record that follows, this far into it, rather than in the gap before it. Absent plays it between two records, which is the simpler path
}

contract AddStationTrackInput: { # Put a catalog record into the running order. Refused at the door — 404 for a record the catalog does not hold, 422 for one whose audio is not local yet — rather than accepted and left to fail when it comes round
    trackId: uuid
    atIndex?: int(min=0) # Where to put it. Absent puts it at the end. A position already handed to the player is refused
}

contract MoveStationItemInput: { # Move an item within the running order
    toIndex: int(min=0)
}

contract ExtendStationInput: { # Add tracks to the running order now, rather than waiting for it to run short
    count?: int(min=1, max=100)
}

contract ReplanStationInput: { # Throw away everything the player is not already holding and programme it again. Unlike a shuffle, the records themselves change; unlike putting the station on air, the broadcast continues
    count?: int(min=1, max=100) # How many records to programme. Absent is roughly an hour
    brief?: string(max=500) # What the station should play from here on, in your own words. Absent keeps whatever this broadcast was already asked for; an empty string CLEARS it, which hands the programming back to the station's ordinary rotation. It steers every later refill too, not just this one batch
}
