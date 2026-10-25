options {
    keys: {
        area: schedule
    }
    services: {
        ScheduleService: "#src/modules/schedule/schedule.service.js"
        SlotPlaylistService: "#src/modules/director/slot.playlist.service.js"
        SlotAirService: "#src/modules/director/slot.air.service.js"
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
        mcp: {
            description: "Which schedule slot the clock says should be on now, and which one the station is actually airing, when the two differ. Use it for questions like what show is on."
        }
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

# The same schedule the list above holds, projected into blocks with both ends.
#
# A slot stores only a START — it runs until the next one begins — so something has to turn a
# partition into a timetable, and it is here rather than in the console because the browser does not
# know the station's timezone and has no business deriving real dates from a weekday mask.

operation /schedule/timetable: {
    get: { # The station's day as blocks, contiguous and gapless, for drawing
        name: Read timetable
        mcp: {
            description: "The station's day as contiguous blocks of programmes, for questions like what is on tonight or when a show starts."
        }
        service: ScheduleService.timetable
        security: {
            # A read, like the list above.
            policy: platform.view
        }
        query: ScheduleTimetableQuery
        response: {
            200: {
                application/json: ScheduleTimetable
            }
        }
    }
}

operation /schedule/{id}: {
    params: {
        id: string(min=1, max=100)
    }
    put: { # Rewrites a slot. Takes effect at its next boundary rather than immediately; to change the show on air too, when it is this slot's, apply the slot afterwards with `POST /schedule/{id}/apply`
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

# Saving a slot never touches the show on air, which is the invariant the schedule lives inside, so
# applying an edit to the show is a separate act an operator takes: a route of its own rather than a
# flag on the save. It lives on a director-side service for SlotPlaylistService's reason below:
# answering it means posting to the director, and the director console already depends on the schedule.

operation /schedule/{id}/apply: {
    params: {
        id: string(min=1, max=100)
    }
    post: { # Applies a slot, as it is saved now, to the show on air, which must be that slot's. Its name, brief, period, moods, rules and host change in place and the broadcast carries on; the records still planned are chosen again against the new programme, and the ones already planned keep playing until the new set is ready. A change to its source, mode, end or co-hosts cannot be made mid-show and waits for the slot's next occurrence
        name: Apply schedule slot to air
        service: SlotAirService.apply
        response: {
            200: {
                application/json: ScheduleSlotApplied
            }
            404:
            # The slot is not the one on air, so there is no show to apply it to. Its change applies
            # the next time it comes round, as every save's does.
            409:
        }
    }
}

# A slot that resumes its playlist keeps its place BESIDE the slot rather than on it, so this is a
# route of its own rather than a field on the slot: the place moves every time a record airs, and a
# slot list that changed with it would never read the same twice.

operation /schedule/{id}/playlist-position: {
    params: {
        id: string(min=1, max=100)
    }
    get: { # The record a slot that resumes its playlist will open on next time, or nothing when it would start from the top
        name: Read slot playlist position
        service: SlotPlaylistService.position
        security: {
            # A read, like the list above.
            policy: platform.view
        }
        response: {
            200: {
                application/json: SlotPlaylistPosition
            }
        }
    }
    delete: { # Forgets where a slot got to in its playlist, so it starts from the top the next time it opens
        name: Restart slot playlist
        service: SlotPlaylistService.restart
    }
}
