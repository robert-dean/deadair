options {
    keys: {
        area: director
    }
}

# What kind of programming a lineup is, which decides the rules it runs under
contract LineupMode: enum(rotation, setlist, feature)

contract LineupOnEnd: enum(extend, repeat, resume, rotation, stop)

contract LineupSummary: { # One lineup as a list shows it, without its order
    id: string(min=1, max=100)
    name: string(min=1, max=200)
    mode: LineupMode
    onEnd: LineupOnEnd
    source: string(min=1, max=50) # Who built it: `import` or `director`
    sourcePluginId?: string(max=200) # Which plugin an imported lineup came from
    sourcePlaylistId?: string(max=400)
    revision: int(min=0) # Bumped on every change to the order. Send it back with an edit and a stale one is refused
    itemCount: int(min=0)
}

contract LineupItem: { # One line of a lineup, which is either a record or something the station says
    id: string(min=1, max=100) # The lineup's own id for this line, which is what an edit names. Not the rundown item id
    kind: enum(track, segment) # Whether this line is a record or something the station says: an ident, a stinger, a talk break
    title: string(min=1, max=400) # The record's title, or the segment's label. What the mount is labelled with while the line airs
    artists: array(string(min=1, max=200)) # Empty for a segment, which has no artist
    committed: boolean # Already handed to the player, and therefore no longer editable. The cursor is the line between this and the rest
    durationMs?: int(min=0)
    pluginId?: string(min=1, max=200) # Absent on a segment: the station serves its own audio
    externalId?: string(min=1, max=400) # Absent on a segment
    album?: string(max=400)
    artworkUrl?: string(max=2000)
    year?: int(min=0)
    trackId?: string(max=100) # The canonical catalog track, when this is one the catalog holds
    segmentId?: string(min=1, max=100) # Which segment this line plays. Present only on a segment
    segmentState?: enum(planned, rendering, ready, failed, gone)
    playable?: boolean # Whether the station can actually air this segment. A line that is not is SKIPPED when the cursor reaches it, rather than held open
    segmentError?: string(max=2000) # Why this segment will not air, in a sentence: nothing could write it, or nothing could speak it. Present only on a failed one
    segmentWriter?: string(max=200) # What decided the words: the station's own templates, or the model that wrote them. Absent on a recording somebody made
}

contract AddLineupSegmentInput: { # Put something the station says into a lineup
    segmentId: string(min=1, max=100)
    atIndex?: int(min=0) # Where to put it. Absent puts it at the end. A position at or before the cursor is refused: the player is already holding that part of the order
    overAtMs?: int(min=0, max=600000) # Play it OVER the record that follows, this far into it, rather than in the gap before it. The station ducks the music under the voice. Absent plays it between two records, which is the simpler path
    revision?: int(min=0)
}

contract Lineup: { # A lineup and its whole order
    id: string(min=1, max=100)
    name: string(min=1, max=200)
    mode: LineupMode
    onEnd: LineupOnEnd
    source: string(min=1, max=50)
    revision: int(min=0)
    cursor: int(min=0) # How far through this lineup the CURRENT broadcast has committed. Zero for a lineup that is not on air, which is honest: nothing has been committed from it
    items: array(LineupItem)
}

contract LineupList: {
    lineups: array(LineupSummary)
}

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

contract ImportLineupInput: { # Build a lineup from a plugin playlist
    pluginId: string(min=1, max=200)
    playlistId: string(min=1, max=400)
    name?: string(min=1, max=200) # What to call it. Absent names it after the plugin, since only the surface that listed the playlist knows its own name for it
    mode?: LineupMode
    onEnd?: LineupOnEnd
}

# What the station does when the running order runs out
contract StationOnEnd: enum(extend, repeat, stop)

# Where an item of the running order has got to. `handed` is a promise and `airing` is a fact, which is the distinction everything here is built around
contract StationItemState: enum(planned, handed, airing, played, skipped)

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
    segmentId?: string(min=1, max=100) # Which segment this plays. Present only on a segment
    segmentState?: enum(planned, rendering, ready, failed, gone)
    playable?: boolean # Whether the station can actually air this segment. One that cannot is SKIPPED when it comes round, rather than held open
    segmentError?: string(max=2000) # Why this segment will not air, in a sentence. Present only on a failed one
    segmentWriter?: string(max=200) # What decided the words: the station's own templates, or the model that wrote them. Absent on a recording somebody made
    overAtMs?: int(min=0) # Heard OVER the record that follows, this far into it, with the music ducked under it. Such an item is never handed to the player in its own right
}

contract StationOrder: { # The station's live running order: what is airing, item by item
    name: string(max=200) # What is on, for a console to draw. A label for this broadcast rather than the name of a stored object
    mode: LineupMode
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
    mode?: LineupMode
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

contract ExtendLineupInput: { # Add tracks to a lineup now, rather than waiting for it to run short
    count?: int(min=1, max=100)
}

contract EditLineupInput: { # An edit, carrying the view of the order it was made against
    revision?: int(min=0) # Absent skips the check. Send it and an edit made against a list that has since changed is refused rather than applied to whatever is in that position now
}

contract MoveLineupItemInput: { # Move a line within a lineup
    toIndex: int(min=0)
    revision?: int(min=0)
}
