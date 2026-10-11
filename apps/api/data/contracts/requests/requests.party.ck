options {
    keys: {
        area: requests
        subarea: party
    }
    services: {
        PartyService: "#src/modules/requests/party.service.js"
    }
    security: {
        # The floor: an operator. Starting a party mints a pass anyone in the room can join with, and
        # ending one turns every guest away, so both are the station's decision. Joining overrides
        # below, because a guest has no account to sign in with: the pass is the credential.
        policy: platform.manage
    }
}

operation /party: {
    get: { # The party that is on, with its pass, so the console can show the QR code again
        name: Get party
        mcp: exclude
        service: PartyService.get
        response: {
            200: {
                application/json: PartyState
            }
        }
    }
    post: { # Start a party. A party already on is ended first, which turns its guests away, so there is only ever one pass to scan
        name: Start party
        mcp: exclude
        service: PartyService.start
        request: {
            application/json: PartyStart
        }
        response: {
            201: {
                application/json: PartyPass
            }
        }
    }
    delete: { # End the party. Its pass stops working and every guest who joined with it is turned away on their next request
        name: End party
        mcp: exclude
        service: PartyService.end
        response: {
            204:
        }
    }
}

operation /party/join: {
    post: { # Join the party as a guest. Answers 404 for a pass that is unknown, ended or run out, without saying which
        name: Join party
        mcp: exclude
        service: PartyService.join
        # Public on purpose: the pass in the body IS the credential, and a guest has no account to
        # present. What it buys is narrow (the `requests.ask` routes and nothing else), joins are
        # limited per address, and a pass admits a bounded number of guests.
        security: none
        request: {
            application/json: PartyJoin
        }
        response: {
            201: {
                application/json: PartyGuestSession
            }
        }
    }
}
