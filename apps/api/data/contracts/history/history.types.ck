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
