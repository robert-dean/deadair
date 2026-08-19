options {
    keys: {
        area: schedule
    }
    services: {
        ScheduleService: "#src/modules/schedule/schedule.service.js"
    }
    security: {
        # The floor is the WRITE end, as in personas beside it: this file is one read and three
        # writes, so a route added without a block of its own is far likelier to be another write,
        # and inheriting the tighter gate is the failure that gets reported rather than the one that
        # goes quiet. The single read overrides it downward.
        policy: platform.manage
    }
}

# Every mutation answers the whole schedule rather than the row it touched, exactly as personas does.
# A slot's span is derived from the NEXT slot's start, so editing one changes how its neighbours read
# and a caller handed back only the row it named is holding a list it has to refetch anyway.
#
# There is no bulk grid save and no orphan count, deliberately. A slot naming a persona or a playlist
# that has since gone is voided when the schedule is RESOLVED rather than refused when it is saved,
# which is the same call `PersonaRepository.presenting` already makes: refusing to broadcast over a
# question about the DJ is worse than falling back to the station's own.

operation /schedule: {
    get: { # Every slot in this station's schedule, earliest in the day first
        name: List schedule
        service: ScheduleService.list
        security: {
            # The one read in the file, so it drops to the read floor the console's other pages use.
            policy: platform.view
        }
        response: {
            200: {
                application/json: ScheduleSlotList
            }
        }
    }
    post: { # Adds a slot. The station does not change over until its start time comes round
        name: Create schedule slot
        service: ScheduleService.create
        request: {
            application/json: ScheduleSlot
        }
        response: {
            201: {
                application/json: ScheduleSlotList
            }
        }
    }
}

# Deliberately separate from the list rather than a field on each slot. Which slot is in force is a
# function of the clock, so it changes without the schedule changing, and folding it into the list
# would make a cached grid go stale every minute for a reason that has nothing to do with the grid.

operation /schedule/current: {
    get: { # Which slot the clock says should be on, and which one the station is actually airing
        name: Read current slot
        service: ScheduleService.current
        security: {
            # A read, like the list above.
            policy: platform.view
        }
        response: {
            200: {
                application/json: ScheduleNow
            }
        }
    }
}

operation /schedule/{id}: {
    params: {
        id: string(min=1, max=100)
    }
    put: { # Rewrites a slot. Takes effect at its next boundary rather than immediately
        name: Update schedule slot
        service: ScheduleService.update
        request: {
            application/json: ScheduleSlot
        }
        response: {
            200: {
                application/json: ScheduleSlotList
            }
        }
    }
    delete: { # Removes a slot. Whatever is on air stays on until the next slot begins
        name: Delete schedule slot
        service: ScheduleService.remove
        response: {
            200: {
                application/json: ScheduleSlotList
            }
        }
    }
}
