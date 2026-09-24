options {
    keys: {
        area: requests
    }
}

contract RequestableTrack: { # A record the station holds and could be asked for
    trackId: uuid # What to send as `trackId` to make the request
    title: string(max=400)
    artist: string(max=400) # The lead artist
    album?: string(max=400)
    year?: int
}

contract RequestableTrackList: { # Records matching a search, best matches first
    tracks: array(RequestableTrack)
}

contract RequestStatus: enum(waiting, pending, queued, aired, declined, expired)

contract RequestSource: enum(app, chat)

contract ListenerRequest: { # A record somebody asked the station to play, and what became of it
    id: uuid
    status: RequestStatus # `waiting` for an operator to approve it, `pending` while its audio is fetched or a place is found for it, `queued` in the running order, `aired` once heard, `declined` or `expired` when it never will be
    title: string(max=400) # The record, as it was called when it was asked for
    artist: string(max=400)
    requesterName: string(max=200) # Who asked, by the name their account or chat platform gave
    source: RequestSource # Whether it came from an app or a chat platform
    createdAt: datetime # When it was asked for
    reason?: string(max=400) # Why it was declined or expired, in the station's words or an operator's
    airedAt?: datetime # When it aired
    dedicateTo?: string(max=60) # Who the listener dedicated it to
    message?: string(max=200) # What the listener asked to have said with it, in their own words
}

contract ListenerRequestList: { # Requests, newest first
    requests: array(ListenerRequest)
}

contract ListenerRequestCreate: { # Ask the station to play a record
    trackId: uuid # A record from the request search
    name?: string(min=1, max=60) # What the station should call you. Omitted, you are "a listener": your account's email address is never shown or read out
    dedicateTo?: string(min=1, max=60) # Dedicate it to somebody. The station may say this name on air
    message?: string(min=1, max=200) # A few words to go with it. The presenter may put them in their own words on air, and leaves out anything unfit to broadcast; the words themselves are never read out
}

contract ListenerRequestDecline: { # Turn a request down
    reason?: string(max=400) # What to tell the listener. Omit for a plain no
}
