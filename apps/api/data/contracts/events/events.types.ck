options {
    keys: {
        area: events
    }
}

contract EventDestination: { # Somewhere the station sends what happens on it: an operator's own server, sent a signed POST per event
    id: readonly uuid
    name: string(min=1, max=200) # What the operator calls it
    url: string(min=1, max=2000) # Where events are POSTed. http or https, and allowed to be on the station's own network. A redirect is never followed
    enabled: boolean # Off sends nothing
    events: array(string(max=100)) # The event types it is sent, from `/events/types`. Empty means every type, including any added later
    consecutiveFailures: readonly int(min=0) # Deliveries in a row that did not arrive. Any delivery that arrives sets it back to nothing; at twenty the station turns the destination off
    disabledReason?: readonly enum(failing) # Set when the station turned it off itself, because it kept failing. Turning it back on clears this and the count
    lastDeliveredAt?: readonly datetime
    lastFailedAt?: readonly datetime
    lastFailure?: readonly string(max=1000) # What went wrong last time, in the station's words
    createdAt: readonly datetime
    updatedAt: readonly datetime
}

contract EventDestinationList: { # Every event destination, oldest first
    destinations: array(EventDestination)
}

contract EventDestinationCreate: { # A new event destination
    name: string(min=1, max=200)
    url: string(min=1, max=2000)
    enabled?: boolean # Defaults to on
    events?: array(string(max=100)) # The event types to send it. Absent or empty means every type
}

contract EventDestinationUpdate: { # Changes to an event destination. Only what is sent changes
    name?: string(min=1, max=200)
    url?: string(min=1, max=2000)
    enabled?: boolean # Turning a destination back on also clears why the station turned it off, and its count of failures
    events?: array(string(max=100)) # Empty means every type
}

contract EventDestinationSecret: { # The secret deliveries to a destination are signed with. Shown only when it is made, so keep it
    secret: string # Put this in the receiver. Each delivery carries `Deadair-Webhook-Signature: v1=<hex HMAC-SHA256 of "<Deadair-Webhook-Timestamp>.<body>">`
}

contract EventDestinationCreated: EventDestination & EventDestinationSecret # A destination just made, with its secret

contract EventDelivery: { # One attempt at sending an event to a destination
    id: uuid
    eventId: uuid # The event's own id, which every attempt at it shares
    eventType: string(max=100)
    attempt: int(min=1)
    outcome: enum(delivered, failed, dropped) # `dropped` is an event no longer worth sending, such as a record that finished playing while its destination was down
    httpStatus?: int # What the destination answered, when it answered at all
    durationMs: int(min=0)
    error?: string(max=1000) # What went wrong, in the station's words. Never the destination's response body
    createdAt: datetime
}

contract EventDeliveryList: { # A destination's latest delivery attempts, newest first. The station keeps the latest fifty
    deliveries: array(EventDelivery)
}

contract EventTestResult: { # What a test delivery came to
    delivered: boolean
    httpStatus?: int # What the destination answered, when it answered at all
    durationMs: int(min=0)
    error?: string(max=1000) # Why it was not delivered, in the station's words
}

contract EventStation: { # Which station sent an event
    key: string
    name: string
}

contract EventEnvelope: { # One event, as a destination receives it. The same shape for every type: read `type`, then `data`
    id: uuid # The event's own id. A redelivery of the same event carries the same one
    type: string(max=100) # What happened, such as `track.started`
    occurredAt: string # When, as an ISO-8601 instant in UTC
    station: EventStation
    data: record(string, unknown) # What the type says it holds. `/events/types` gives an example of each
}

contract EventType: { # One kind of event the station sends
    type: string(max=100)
    description: string # When it is sent, and what its `data` holds
    subscribable: boolean # False for the test event, which only a test delivery sends
    example: EventEnvelope
}

contract EventTypeList: { # Every kind of event the station sends
    types: array(EventType)
}

contract TrackStartedData: { # `data` of `track.started`: a record began playing, as listeners heard it
    itemId: string # The running order's id for this play
    title: string
    artists: array(string) # The credit as the release writes it
    artist: string # The credit as one line, for showing
    album?: string
    year?: int
    trackId?: uuid # The station's catalog id, where the record is in the catalog
    durationMs?: int(min=0)
    endsAt?: string # When it should finish, as an ISO-8601 instant in UTC
    artworkUrl?: string # The cover as the station serves it publicly, or the station's logo. Absent when the station has no public address
}

contract TalkStartedData: { # `data` of `talk.started`: the station began speaking, in a break or a bulletin
    itemId: string
    segmentId: uuid
    kind: string # What sort of break: `talkbreak`, `news`, `weather`, `welcome` and so on
    label?: string # What a listener may be told it is, where the writer said
    durationMs?: int(min=0)
    endsAt?: string # When it should finish, as an ISO-8601 instant in UTC
}

contract ProductionStartedData: { # `data` of `production.started`: a produced piece, such as a phone-in or a guest, began. Sent once per production
    itemId: string
    productionId: uuid
    kind: string # What sort of production: `callin`, `visit`, `banter` and so on
    title: string
    durationMs?: int(min=0)
    endsAt?: string # When it should finish, as an ISO-8601 instant in UTC
}

contract ProgrammeStartedData: { # `data` of `programme.started`: a programme the station carries began, a podcast episode or a reading
    itemId: string
    segmentId: uuid
    source: enum(podcast, narration) # A podcast episode as published, or something the station reads out itself
    show?: string
    episode: string
    durationMs?: int(min=0)
    endsAt?: string # When it should finish, as an ISO-8601 instant in UTC
}

contract StationAirData: { # `data` of `station.onAir` and `station.offAir`: the station went on air, or came off it
    reason: enum(programme, resumed, stopped, ranOut) # A new running order, the stopped one started again, somebody stopping it, or the running order running out
    programme?: string # The running order's name, when going on air with a new one that has one
}

contract RequestDedication: { # Who a request is dedicated to, and what the listener wanted said. The listener's own words
    to?: string
    message?: string
}

contract RequestReceivedData: { # `data` of `request.received`: a listener asked for a record, from an app, the console, a party pass or a chat
    requestId: uuid
    trackId: uuid
    title: string
    artist: string
    requesterName: string # What the listener is called, as the station names them
    via: enum(app, chat) # Where they asked from. `app` covers the console, the listener apps and a party pass
    status: enum(waiting, pending, queued, aired, declined, expired) # How it stands now: waiting on an operator, waiting on its audio, in the running order, or declined
    reason?: string # Why it was declined, as the listener is told
    insisted?: boolean # The listener asked for it again after the station turned it down for its own taste
    dedication?: RequestDedication
}
