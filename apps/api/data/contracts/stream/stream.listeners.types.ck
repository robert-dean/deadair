options {
    keys: {
        area: stream
    }
}

contract ListenerConnection: { # One connection to the station's stream, as it stands at the moment of reading
    via: enum(icecast, hls) # `icecast` is a player holding a connection open on a mount. `hls` is a player re-fetching a playlist, counted while it keeps asking
    mount?: string(min=1, max=200) # The Icecast mount it is on, such as `/live.mp3`. Absent over HLS, whose players are counted across every playlist together
    address: string(min=1, max=64) # The address the station recorded. A listener's own only where the edge in front of the station is trusted to say so; behind a tunnel without `REAL_IP_FROM` it is the tunnel's
    agent?: string(min=1, max=512) # What the player said it was, cut to 512 characters. Absent when it sent nothing
    connectedMs: int(min=0) # How long it has been connected, to the second. Over HLS, since the first playlist fetch of this stretch of listening
}

contract UnreadableMount: { # An Icecast mount whose connections could not be read, so its listeners are missing from the list
    mount: string(min=1, max=200)
    reason: enum(unresolved, refused, unanswered) # `unresolved`: the station has not yet found an Icecast 2.5 it can ask. `refused`: Icecast answered 401 or 403. `unanswered`: a timeout, a failed connection, or a reply that was not a client list
}

contract StreamListeners: { # Who is connected to the station's stream right now. Read on request and never stored
    readAt: datetime # When this was read
    total: int(min=0) # The audience count the station is acting on, the same figure as the console's tally. It can differ from the number of connections: it is kept by a separate reading, and one HLS entry can stand for two players with the same address and agent
    connections: array(ListenerConnection) # Every connection that could be read, Icecast mounts first in the station's mount order, then HLS, each longest-connected first
    unreadable: array(UnreadableMount) # The mounts that could not be read. Empty when every one was. A mount listed here is not an empty mount
}
