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
    days?: array(int(min=0, max=6)) # For a `clock` band: the weekdays it happens on, Sunday 0, on the station's own clock. Absent or empty means every day
    hard?: boolean # For a `clock` band: airs at its time exactly and never before it, waiting when the order comes up early and cutting the record in the way when it runs late. Absent or false is a soft marker, which airs at the first boundary after its time
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

# What a band in a file is about, carried whole so the file works on a station that has never heard of it
contract ClockPackTopic: {
    key: string(min=1, max=100) # What identifies it within the band's kind
    label: string(min=1, max=200) # What a break calls it out loud
    config?: record(string, unknown) # This sort of break's own settings for this subject
}

# One rule in a file. Nothing about the station it came from: no id, no place in its order, and no switch
contract ClockPackRow: {
    kind: string(min=1, max=100) # Which sort of break it wants, as `segments.kind` spells it
    at: enum(clock, interval)
    hour?: int(min=0, max=23)
    minute?: int(min=0, max=59)
    days?: array(int(min=0, max=6))
    hard?: boolean
    everyMs?: int(min=60000)
    topic?: ClockPackTopic
}

# A format clock as one file, to hand to another station. Each entry is read as a `ClockPackRow` when it
# is imported, so one a station cannot use is reported rather than refusing the file
contract ClockPack: {
    format: literal("deadair.clock") # Says the file is a clock file
    version: int(min=1) # The version of the document's shape. This station reads version 1
    name: string(min=1, max=100) # What the file is, as whoever made it would describe it
    bands: array(record(string, unknown), max=500)
}

# What an import did, and the clock as it now stands
contract ClockImportResult: {
    plan: readonly PackImportPlan
    list: readonly ClockBandList
}
