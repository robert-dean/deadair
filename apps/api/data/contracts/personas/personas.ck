options {
    keys: {
        area: personas
    }
    services: {
        PersonasService: "#src/modules/personas/personas.service.js"
        PersonaRehearsalService: "#src/modules/personas/persona.rehearsal.service.js"
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

# Writes nothing. A sheet is eight fields and its markers have to be words the character would
# actually say — get those wrong and every break declines, which looks exactly like a model that is
# switched off — so the cost of authoring one by hand is what stands between the design and an
# operator using it. This fills the form in; saving it is still POST /personas.
#
# A model that is absent answers 503 with the sentence the LLM module writes for it, because a
# station with no model plugin is an ordinary state rather than a fault.
operation /personas/generate: {
    post: { # Turns a description of a character into a whole persona, checked against its own sample lines and handed back unsaved
        name: Generate persona
        service: PersonasService.generate
        request: {
            application/json: PersonaRequest
        }
        response: {
            200: {
                application/json: GeneratedPersona
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

# A rehearsal, never something that can air. It writes no segment, no script history and no request:
# the service reaches the writers and the persona table and nothing else, so "this cannot be planted"
# is a fact about what it holds rather than a rule to remember. The voice sample under
# `/voices/{id}/sample` is the same shape for the same reason.
#
# A POST rather than a GET despite reading nothing, because it spends a generation: it is not safe to
# retry, not cacheable, and a console that prefetched it would take the model slot off a real break.
operation /personas/{id}/rehearse: {
    params: {
        id: string(min=1, max=100)
    }
    post: { # Writes a talk break under this persona against two fixed invented records, and answers with every writer that was asked
        name: Rehearse persona
        service: PersonaRehearsalService.rehearse
        response: {
            200: {
                application/json: PersonaRehearsal
            }
        }
    }
}
