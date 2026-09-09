options {
    keys: {
        area: personas
    }
    services: {
        PersonaAuditionService: "#src/modules/personas/persona.audition.service.js"
    }
    security: {
        # The same floor `personas.ck` sets, and for the same reason: this file is two reads and two
        # operator actions, and a route added without a block of its own is more likely to be another
        # action. The two reads override it downward.
        policy: platform.manage
    }
}

# ── Hearing a character over an hour of records ───────────────────────────────────────
#
# Its own file rather than four more operations in `personas.ck`, on the same argument that keeps the
# notes and the stories in one file and the sheet in another: an audition has its own storage, its own
# job and its own lifecycle, and the thing `personas.ck` is about is the character sheet.
#
# The verb next door writes ONE break against two fixed invented records. That is a measurement of a
# sheet edit and is deliberately repeatable — no facts, no history, the same pair every time. What it
# cannot tell an operator is whether a character holds up over real material: whether it repeats
# itself by the fourth break, whether the model starts declining once there are facts in front of it,
# what the floor sounds like when it covers. That was previously only knowable by putting the
# character on air and waiting an evening.
#
# So an audition is a RUN: one persona, one playlist, one talk break per transition, written one at a
# time and airing nothing.

# Asking for one QUEUES it, exactly as commissioning a production does, and for a sharper version of
# the same reason. Every transition is a generation at the `preview` tier, which queues behind
# everything the station does for itself and is preempted the moment a real break wants the model, so
# a run of twenty is minutes to hours and none of it may happen inside a request. One job per
# transition writes one break and sends the next; the row says which is next, so a run survives a
# restart and the station's one model slot is free in between.
operation /personas/{id}/auditions: {
    params: {
        id: string(min=1, max=100)
    }
    get: { # Every audition of this character, newest first, without their breaks
        name: List persona auditions
        service: PersonaAuditionService.list
        security: {
            # A read, so it drops to the floor the console's other pages use.
            policy: platform.view
        }
        response: {
            200: {
                application/json: PersonaAuditionList
            }
        }
    }
    post: { # Asks the station to put this character through a playlist. It is queued, not written
        name: Start persona audition
        service: PersonaAuditionService.start
        request: {
            application/json: PersonaAuditionRequest
        }
        response: {
            201: {
                application/json: PersonaAudition
            }
        }
    }
}

operation /personas/{id}/auditions/{auditionId}: {
    params: {
        id: string(min=1, max=100)
        auditionId: string(min=1, max=100)
    }
    get: { # One audition with every break it has written so far, in order
        name: Get persona audition
        service: PersonaAuditionService.get
        security: {
            policy: platform.view
        }
        response: {
            200: {
                application/json: PersonaAudition
            }
        }
    }
}

# Terminal, on `POST /productions/{id}/cancel`'s argument: a queue cannot cancel. Everything already
# sent will still be delivered, so this writes a state no job can claim out of, and every job checks
# the row before it spends a generation.
#
# A run that has already finished is refused rather than rewritten. What it wrote, it wrote.
operation /personas/{id}/auditions/{auditionId}/cancel: {
    params: {
        id: string(min=1, max=100)
        auditionId: string(min=1, max=100)
    }
    post: { # Stops an audition where it stands, keeping the breaks it has already written
        name: Cancel persona audition
        service: PersonaAuditionService.cancel
        response: {
            200: {
                application/json: PersonaAuditionSummary
            }
        }
    }
}
