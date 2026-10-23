options {
    keys: {
        area: history
    }
}

contract HistoryEntry: { # One record the station actually played
    id: string(min=1, max=100) # Unique across the history, and half of the cursor below
    airedAt: datetime # When it started, written when it began rather than when it was handed to the player
    title: string(min=1, max=500)
    artists: string(min=1, max=1000) # The credit as written, whole: one line rather than a list, because that is the shape a release credits itself in and splitting it renames acts with a comma in their name
    album?: string(max=500) # Absent for anything aired straight from a provider, which the catalog holds no record for
    artworkUrl?: string(max=2000) # The station's own copy where it has one, as a path under the API root, and the upstream URL until then. Resolve it against the base the station is reached at
    durationMs?: int(min=0) # How long the recording runs, from the catalog rather than from the copy that played
    trackId?: string(max=100) # The catalog track this was, for a client that wants to ask more about it. Absent for a record the catalog does not hold, and for one it has since forgotten
}

contract HistoryQuery: { # One page of the history, newest first
    limit?: int(min=1, max=200)
    before?: string(min=1, max=200) # Where the previous page ended. Opaque, and a keyset rather than an offset because rows arrive at the head continuously: an offset would re-show a row on every page as the station kept playing under it. Pass back whatever `nextBefore` said and nothing else
}

contract HistoryPage: {
    entries: array(HistoryEntry)
    nextBefore?: string(min=1, max=200) # The cursor for the page after this one, absent once the history has been read to its end
}

# What one line of the as-run log is.
#
#   record, break, programme   something that went out, with when it started and, once the station saw it end, when it ended
#   gap                        the station aired its local bed instead of the running order. Only gaps long enough to matter are recorded
#   onAir, offAir              the station was put on air, or stood down
contract AsRunKind: enum(record, break, programme, gap, onAir, offAir)

contract AsRunEntry: { # One line of what actually went out
    id: string(min=1, max=100) # Unique across the log, and half of the cursor below
    kind: AsRunKind
    at: datetime # When it started. For an item, the moment the player said so, not when it was handed over
    endedAt?: datetime # When it stopped. Absent while an item is on air, and for one the station never saw end, such as the last item before a crash
    title?: string(max=500) # A record's title or a break's label, as it went out
    artists?: string(max=1000) # A record's credit as written, whole
    trackId?: string(max=100) # The catalog track a record was
    segmentId?: string(max=100) # The segment a break or a programme was
    passedOver?: int(min=0) # How many items already handed to the player it moved past to reach this one. They never aired. Absent when none
    detail?: string(max=2000) # For a gap or an air change, the station's own sentence about it
}

contract AsRunQuery: { # One page of the as-run log, newest first
    limit?: int(min=1, max=500)
    before?: string(min=1, max=200) # Where the previous page ended. Opaque: pass back whatever `nextBefore` said
    until?: datetime # Start reading from this moment back, to jump to an hour without paging to it. Ignored when `before` is sent
}

contract AsRunPage: {
    entries: array(AsRunEntry)
    nextBefore?: string(min=1, max=200) # The cursor for the page after this one, absent once the log has been read to its end
}
