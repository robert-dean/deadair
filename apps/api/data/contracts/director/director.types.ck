options {
    keys: {
        area: director
    }
}

# What kind of programming a lineup is, which decides the rules it runs under
contract LineupMode: enum(rotation, setlist, feature)

# What the station does when a lineup runs out. Separate from the mode, because every answer is valid for a feature and which one an operator wants is a decision about their station
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

contract LineupItem: { # One line of a lineup
    id: string(min=1, max=100) # The lineup's own id for this line, which is what an edit names. Not the rundown item id
    pluginId: string(min=1, max=200)
    externalId: string(min=1, max=400)
    title: string(min=1, max=400)
    artists: array(string(min=1, max=200))
    durationMs?: int(min=0)
    album?: string(max=400)
    artworkUrl?: string(max=2000)
    year?: int(min=0)
    trackId?: string(max=100) # The canonical catalog track, when this is one the catalog holds
    committed: boolean # Already handed to the player, and therefore no longer editable. The cursor is the line between this and the rest
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
