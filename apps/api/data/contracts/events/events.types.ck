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
}

contract EventDestinationUpdate: { # Changes to an event destination. Only what is sent changes
    name?: string(min=1, max=200)
    url?: string(min=1, max=2000)
    enabled?: boolean
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
