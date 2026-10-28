options {
    keys: {
        area: events
    }
    services: {
        EventDestinationsService: "#src/modules/events/event.destinations.service.js"
    }
    security: {
        # The floor, reads included: a destination's address often carries its own secret (a home
        # automation hub's webhook id is the whole of its protection), so reading the list is an
        # operator's business. The routes that hand out a signing secret, and the one that can move
        # an address, are kept out of MCP and ask for a recent strong factor in the service.
        policy: platform.manage
    }
}

operation /events/types: {
    get: { # Every kind of event the station sends, each with an example of what a destination receives
        name: List event types
        service: EventDestinationsService.listTypes
        response: {
            200: {
                application/json: EventTypeList
            }
        }
    }
}

operation /events/destinations: {
    get: { # Every event destination, oldest first
        name: List event destinations
        service: EventDestinationsService.list
        response: {
            200: {
                application/json: EventDestinationList
            }
        }
    }
    post: { # Add an event destination. The answer carries its signing secret, which is not shown again
        name: Create event destination
        mcp: exclude
        service: EventDestinationsService.create
        request: {
            application/json: EventDestinationCreate
        }
        response: {
            201: {
                application/json: EventDestinationCreated
            }
        }
    }
}

operation /events/destinations/{id}: {
    params: {
        id: uuid
    }
    patch: { # Change an event destination's name, address, or whether it is on
        name: Update event destination
        mcp: exclude
        service: EventDestinationsService.update
        request: {
            application/json: EventDestinationUpdate
        }
        response: {
            200: {
                application/json: EventDestination
            }
        }
    }
    delete: { # Remove an event destination and its delivery log
        name: Delete event destination
        service: EventDestinationsService.remove
        response: {
            204:
        }
    }
}

operation /events/destinations/{id}/secret: {
    params: {
        id: uuid
    }
    post: { # Make a new signing secret for a destination. The old one stops working at once
        name: Rotate event destination secret
        mcp: exclude
        service: EventDestinationsService.rotateSecret
        response: {
            200: {
                application/json: EventDestinationSecret
            }
        }
    }
}

operation /events/destinations/{id}/test: {
    params: {
        id: uuid
    }
    post: { # Send a destination a test event now, and say what it answered. Sent even when the destination is off
        name: Test event destination
        service: EventDestinationsService.test
        response: {
            200: {
                application/json: EventTestResult
            }
        }
    }
}

operation /events/destinations/{id}/deliveries: {
    params: {
        id: uuid
    }
    get: { # A destination's latest delivery attempts, newest first
        name: List event deliveries
        service: EventDestinationsService.listDeliveries
        response: {
            200: {
                application/json: EventDeliveryList
            }
        }
    }
}
