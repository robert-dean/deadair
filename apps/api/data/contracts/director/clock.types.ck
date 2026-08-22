options {
    keys: {
        area: director
    }
}

# One rule on the station's format clock: a sort of break, and when it happens
contract ClockBand: {
    id: readonly string(min=1, max=100)
    kind: string(min=1, max=100) # Which sort of break this slot wants, as `segments.kind` spells it. Free text: a station that wants sponsor spots writes `sponsor` and drops the recordings in
    at: enum(clock, interval) # `clock` is a time of day and `interval` is a spacing rule for a kind the station's own interval does not cover
    hour?: int(min=0, max=23) # For a `clock` band: the hour it happens at. Absent means every hour, which is the common case
    minute?: int(min=0, max=59) # For a `clock` band: minutes past the hour
    everyMs?: int(min=60000) # For an `interval` band: how far apart, in milliseconds
    position: int(min=0) # Where this sits in the operator's own order, which is what settles a boundary two rules both want
    enabled: boolean # A rule turned off without being lost
    topicId?: string(min=1, max=100) # What this band is about, as a subject of its own kind: a news category, later a weather location. Absent means it covers whatever it finds
    topicLabel?: readonly string(min=1, max=200) # That subject's name, so a list can be drawn without a second call
}

contract ClockBandList: {
    bands: array(ClockBand)
    producibleKinds: array(string(min=1, max=100)) # Which sorts of break this station can actually make right now: one it can write and speak, one it has recordings of, or one it produces as an episode. A band naming anything else claims its boundary and then passes over it
}
