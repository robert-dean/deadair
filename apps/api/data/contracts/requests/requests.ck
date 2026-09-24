options {
    keys: {
        area: requests
    }
    services: {
        RequestsService: "#src/modules/requests/requests.service.js"
    }
    security: {
        # The floor: anybody signed in with a platform role, which a listener account holds. Asking
        # for a record and following your own requests is exactly what a listener app is for, so it
        # is not an operator's action. Deciding on somebody else's request is, and overrides below.
        policy: platform.view
    }
}

operation /requests/search: {
    get: { # Records the station could be asked to play, matching a title or an artist
        name: Search requestable records
        mcp: {
            description: "Finds records listeners can ask the station to play, by title, artist or both. Use it before create_request to get the trackId; it answers at most 25."
        }
        service: RequestsService.search
        query: {
            q: string(min=1, max=200) # What to look for: a title, an artist, or both
            limit?: int(min=1, max=25) # How many to answer with. Ten when omitted
        }
        response: {
            200: {
                application/json: RequestableTrackList
            }
        }
    }
}

operation /requests: {
    get: { # Every recent request, for the operator deciding on them
        name: List requests
        service: RequestsService.list
        query: {
            status?: RequestStatus # Only requests in this state
        }
        security: {
            policy: platform.manage
        }
        response: {
            200: {
                application/json: ListenerRequestList
            }
        }
    }
    post: { # Ask the station to play a record. Answers with the request whatever became of it, so a refusal says why in `reason`
        name: Create request
        mcp: {
            description: "Asks the station to play a record, as a listener would, with an optional name, dedication and message. Get the trackId from search_requestable_records first. It always answers with the request: a refused one says why in reason, and a waiting one plays once an operator lets it through."
        }
        service: RequestsService.create
        request: {
            application/json: ListenerRequestCreate
        }
        response: {
            201: {
                application/json: ListenerRequest
            }
        }
    }
}

operation /requests/mine: {
    get: { # The signed-in account's own recent requests
        name: List my requests
        mcp: {
            description: "This person's own recent requests and what became of each: waiting, playing, played or refused, with the reason."
        }
        service: RequestsService.mine
        response: {
            200: {
                application/json: ListenerRequestList
            }
        }
    }
}

operation /requests/{id}/grant: {
    params: {
        id: uuid
    }
    post: { # Let a waiting request through. It goes into the running order once its audio is here
        name: Grant request
        service: RequestsService.grant
        security: {
            policy: platform.manage
        }
        response: {
            200: {
                application/json: ListenerRequest
            }
        }
    }
}

operation /requests/{id}/decline: {
    params: {
        id: uuid
    }
    post: { # Turn a request down. One already in the running order is left there; take it out of the order instead
        name: Decline request
        service: RequestsService.decline
        request: {
            application/json: ListenerRequestDecline
        }
        security: {
            policy: platform.manage
        }
        response: {
            200: {
                application/json: ListenerRequest
            }
        }
    }
}
