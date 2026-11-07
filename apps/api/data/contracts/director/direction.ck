options {
    keys: {
        area: director
    }
    services: {
        TalkDirectionService: "#src/modules/director/talk.direction.service.js"
    }
    security: {
        # The floor is the WRITE end, as on the rules: two of the three verbs are writes, so a verb
        # added without its own block inherits the tighter gate. The read overrides it downward.
        policy: platform.manage
    }
}

# The one talk direction the station can be given. Its own path rather than under `/rules`, because
# `/rules/{id}` would match it and answer every write to it from the id check.

operation /direction: {
    get: { # The direction in force, if any
        name: Read the talk direction
        service: TalkDirectionService.read
        security: {
            policy: platform.view
        }
        response: {
            200: {
                application/json: TalkDirectionReading
            }
        }
    }
    put: { # Gives the presenters a line to lean on for a number of hours, replacing any direction already in force. Breaks already written are not rewritten
        name: Direct the presenters
        service: TalkDirectionService.direct
        request: {
            application/json: TalkDirectionInput
        }
        response: {
            200: {
                application/json: TalkDirectionReading
            }
        }
    }
    delete: { # Ends the direction now. Breaks already written are not rewritten
        name: Stop directing the presenters
        service: TalkDirectionService.stop
        response: {
            200: {
                application/json: TalkDirectionReading
            }
        }
    }
}
