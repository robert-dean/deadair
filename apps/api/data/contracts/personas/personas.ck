options {
    keys: {
        area: personas
    }
    services: {
        PersonasService: "#src/modules/personas/personas.service.js"
    }
    security: {
        # The floor for this file is the WRITE end, unlike settings beside it, because this file is
        # one read and four writes: a route added here without a block of its own is far more likely
        # to be another write, and inheriting the tighter gate is the failure that gets reported
        # rather than the one that goes quiet. The single read overrides it downward.
        policy: platform.manage
    }
}

# Every mutation answers the whole list rather than the row it touched. Putting one persona on air
# takes another off, and deleting one can leave the station with none active, so a caller that got
# back only the row it named would be holding a list it has to refetch anyway.

operation /personas: {
    get: { # Every persona this station has, oldest first
        name: List personas
        service: PersonasService.list
        security: {
            # The one read in the file, so it drops to the read floor the console's other pages use.
            policy: platform.view
        }
        response: {
            200: {
                application/json: PersonaList
            }
        }
    }
    post: { # Writes a new persona. It is not put on air by creating it
        name: Create persona
        service: PersonasService.create
        request: {
            application/json: Persona
        }
        response: {
            201: {
                application/json: PersonaList
            }
        }
    }
}

operation /personas/restore: {
    post: { # Writes back whichever of the station's own personas this station is missing, touching nothing it already has and putting nothing on air
        name: Restore station personas
        service: PersonasService.restore
        response: {
            200: {
                application/json: PersonaList
            }
        }
    }
}

operation /personas/{id}: {
    params: {
        id: string(min=1, max=100)
    }
    put: { # Rewrites one persona. An edit to the one on air is heard on the next break
        name: Update persona
        service: PersonasService.update
        request: {
            application/json: Persona
        }
        response: {
            200: {
                application/json: PersonaList
            }
        }
    }
    delete: { # Removes a persona, including the one on air, which leaves the station with none
        name: Delete persona
        service: PersonasService.remove
        response: {
            200: {
                application/json: PersonaList
            }
        }
    }
}

operation /personas/{id}/active: {
    params: {
        id: string(min=1, max=100)
    }
    put: { # Puts this persona on air and takes the previous one off
        name: Put persona on air
        service: PersonasService.setActive
        response: {
            200: {
                application/json: PersonaList
            }
        }
    }
}
