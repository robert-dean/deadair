options {
    keys: {
        area: activity
    }
}

# Which part of the station an entry came from, and the console's one filter axis
contract ActivityModule: enum(playout, director, render, catalog, plugins)

# How an entry reads, not how bad it is. There is deliberately no `waiting`: a station idling for
# want of a listener says so in its own words and stays `info`, for the same reason the transport
# reports it as `ready` rather than as a mild fault
contract ActivitySeverity: enum(info, warn, fault)

contract ActivityEntry: { # One thing that happened, from whichever of the feed's sources holds it
    id: string(min=1, max=100) # Unique across the whole feed, and half of the cursor below
    at: datetime # When it happened, as the database recorded it
    module: ActivityModule
    kind: string(min=1, max=100) # Dotted and stable: `silence.cause`, `air.on`, `segment.ready`, `track.aired`. What a console draws a line with, never something a decision is made on
    severity: ActivitySeverity
    detail: string(min=1, max=2000) # The sentence a person reads, phrased by whatever produced it
    data?: record(string, unknown) # The structured half, for a reader that wants to filter or chart rather than read
    segmentId?: string(max=100) # The segment this is about, for an entry that came from one
    trackId?: string(max=100) # The catalog track this is about, for an entry that came from one
}

contract ActivityQuery: { # One page of the feed, newest first
    limit?: int(min=1, max=200)
    before?: string(min=1, max=200) # Where the previous page ended. Opaque, and a keyset rather than an offset because rows arrive at the head continuously: an offset would re-show a row on every page as the feed grew under it. Pass back whatever `nextBefore` said and nothing else
    module?: ActivityModule
    minSeverity?: ActivitySeverity # The floor, not the exact match: `warn` answers with warnings and faults. Absent is everything
}

contract ActivityPage: {
    entries: array(ActivityEntry)
    nextBefore?: string(min=1, max=200) # The cursor for the page after this one, absent once the feed has been read to its end
}
