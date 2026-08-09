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
    active: boolean # False means the station was stood down. The lineup is remembered so the console can still say what it was playing
    airMode: AirMode # What puts the station on air. In `audience` mode a station that is active with a full running order is still silent while nobody is connected, which is the intended state and not a fault
    lineupId?: string(max=100)
    lineupName?: string(max=200)
    cursor: int(min=0)
    remaining: int(min=0) # Lines left in the lineup before it runs out and `onEnd` decides what happens
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

contract PutOnAirInput: { # Put a lineup on air, from the top
    lineupId: string(min=1, max=100)
    interrupting?: boolean # Remember what this displaced, so a lineup ending with `resume` hands the station back to it. What an album feature wants; not what an operator changing programming wants
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
