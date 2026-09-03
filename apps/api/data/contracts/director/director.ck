options {
    keys: {
        area: director
    }
    services: {
        DirectorConsoleService: "#src/modules/director/director.console.service.js"
    }
}

# ── The station's programming ──────────────────────────────────────────────────────────
#
# Reading is `platform.view`, changing it is `platform.manage`: seeing what the station is
# playing is what a listener's console shows, while putting something on air or reordering
# it is an operator action every listener hears.
#
# There is no revision on anything here, and nothing to be stale against. What is on air is
# one object with one owner: an edit is applied by the director itself, in the order it was
# received, so there is no second copy for a console to have drawn from.

operation /director/air: {
    get: { # What the station is airing, and whether it is driving at all
        name: Get station air
        service: DirectorConsoleService.getAir
        security: {
            policy: platform.view
        }
        response: {
            200: {
                application/json: StationAir
            }
        }
    }
    post: { # Puts the station on air, building the running order from a playlist read at this moment. What is playing finishes: changing the programming is not a reason to cut a listener off mid-track
        name: Put the station on air
        service: DirectorConsoleService.putOnAir
        security: {
            policy: platform.manage
        }
        request: {
            application/json: PutOnAirInput
        }
        response: {
            200: {
                application/json: StationAir
            }
        }
    }
    patch: { # Changes what puts the station on air: only while somebody is listening, or whenever there is a programme. Takes effect at once rather than at the next boundary
        name: Set the air mode
        service: DirectorConsoleService.setAirMode
        security: {
            policy: platform.manage
        }
        request: {
            application/json: SetStationAirInput
        }
        response: {
            200: {
                application/json: StationAir
            }
        }
    }
}

# ── The live running order ─────────────────────────────────────────────────────────────
#
# What is ON AIR, which is one thing per station and is owned outright by the director.
# Every route here posts a command to it rather than writing the order, because a second
# writer of a running order is the whole class of bug this shape exists to remove. See
# `docs/decisions/on-air-ownership.md`.

operation /director/air/order: {
    get: { # The live running order, item by item, each saying where it has got to
        name: Get the running order
        service: DirectorConsoleService.getOrder
        security: {
            policy: platform.view
        }
        response: {
            200: {
                application/json: StationOrder
            }
        }
    }
}

operation /director/air/persona: {
    put: { # Changes who is presenting this broadcast. Breaks already written for it in the outgoing character are written again in the new one
        name: Recast the broadcast
        service: DirectorConsoleService.recast
        security: {
            policy: platform.manage
        }
        request: {
            application/json: SetStationHostInput
        }
        response: {
            200: {
                application/json: StationOrder
            }
        }
    }
}

operation /director/air/extend: {
    post: { # Queues a refill and returns at once. Generating a set walks the catalog, and an operator pressing a button should not be held open through it
        name: Extend the running order
        service: DirectorConsoleService.extendOrder
        security: {
            policy: platform.manage
        }
        request: {
            application/json: ExtendStationInput
        }
        response: {
            202:
        }
    }
}

operation /director/air/replan: {
    post: { # Queues a fresh set for everything the player is not already holding, and swaps it in once it exists. The old tail keeps playing until then, because emptying the running order first would take the station off air while the model was still choosing
        name: Replan the running order
        service: DirectorConsoleService.replanOrder
        security: {
            policy: platform.manage
        }
        request: {
            application/json: ReplanStationInput
        }
        response: {
            202:
        }
    }
}

operation /director/air/hold: {
    patch: { # Holds the running order against the schedule, so a block boundary does not take back what an operator put on. A takeover is otherwise stamped with whichever slot was in force and is replaced when that block ends, which is correct and gives nobody any warning
        name: Hold the station against the schedule
        service: DirectorConsoleService.holdAgainstSchedule
        security: {
            policy: platform.manage
        }
        request: {
            application/json: HoldStationInput
        }
        response: {
            200: {
                application/json: StationAir
            }
        }
    }
    delete: { # Releases a hold, so the next block boundary changes the station over as it ordinarily would. A station with no hold is unchanged rather than refused
        name: Release the station to the schedule
        service: DirectorConsoleService.releaseToSchedule
        security: {
            policy: platform.manage
        }
        response: {
            200: {
                application/json: StationAir
            }
        }
    }
}

operation /director/air/shuffle: {
    post: { # Shuffles the records not yet handed to the player, and plants the breaks again around the new sequence. The head is already in the player's hands and is left alone
        name: Shuffle the running order
        service: DirectorConsoleService.shuffleOrder
        security: {
            policy: platform.manage
        }
        response: {
            200: {
                application/json: StationOrder
            }
        }
    }
}

operation /director/air/segments: {
    post: { # Puts something the station says into the running order. A segment with no audio yet is refused here rather than accepted and skipped when it comes round, so an operator is told why it cannot play
        name: Add a segment to the running order
        service: DirectorConsoleService.addSegmentToOrder
        security: {
            policy: platform.manage
        }
        request: {
            application/json: AddStationSegmentInput
        }
        response: {
            200: {
                application/json: StationOrder
            }
        }
    }
}

operation /director/air/tracks: {
    post: { # Puts a catalog record into the running order. A record whose audio is not local yet is refused here rather than accepted and held or skipped when its slot comes round, so an operator asking for a specific one is told why it cannot play. What makes this worth having on its own is undo: dropping an item only ever marks a segment, but a track is spliced out of the order entirely, so nothing could put one back until this existed
        name: Add a record to the running order
        service: DirectorConsoleService.addTrackToOrder
        security: {
            policy: platform.manage
        }
        request: {
            application/json: AddStationTrackInput
        }
        response: {
            200: {
                application/json: StationOrder
            }
        }
    }
}

operation /director/air/items/{itemId}: {
    params: {
        itemId: string(min=1, max=100)
    }
    patch: { # Moves an item. A position already handed to the player is refused rather than clamped
        name: Move a running order item
        service: DirectorConsoleService.moveOrderItem
        security: {
            policy: platform.manage
        }
        request: {
            application/json: MoveStationItemInput
        }
        response: {
            200: {
                application/json: StationOrder
            }
        }
    }
    delete: { # Drops an item that has not been handed to the player yet
        name: Remove a running order item
        service: DirectorConsoleService.removeOrderItem
        security: {
            policy: platform.manage
        }
        response: {
            200: {
                application/json: StationOrder
            }
        }
    }
}
