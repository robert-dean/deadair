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
# Reading is `platform.view`, changing it is `platform.manage`: seeing what the station
# means to play is what a listener's console shows, while importing, reordering or putting
# something on air is an operator action every listener hears.
#
# Every mutating route takes the revision the caller last read and answers 409 when it has
# moved. A console draws a list and an operator acts on what they can see; if the director
# has appended in between, the position they picked no longer means what it meant.

operation /director/lineups: {
    get: { # Every lineup the station holds, without their orders
        name: List lineups
        service: DirectorConsoleService.listLineups
        security: {
            policy: platform.view
        }
        response: {
            200: {
                application/json: LineupList
            }
        }
    }
    post: { # Builds a lineup from a plugin playlist. Does not put it on air: importing and airing are separate decisions
        name: Import a lineup
        service: DirectorConsoleService.importPlaylist
        security: {
            policy: platform.manage
        }
        request: {
            application/json: ImportLineupInput
        }
        response: {
            201: {
                application/json: Lineup
            }
        }
    }
}

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
    post: { # Puts a lineup on air from the top. What is playing finishes: changing the programming is not a reason to cut a listener off mid-track
        name: Put a lineup on air
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

operation /director/lineups/{lineupId}: {
    params: {
        lineupId: string(min=1, max=100)
    }
    get: { # One lineup and its whole order, with the cursor marking what has already been handed to the player
        name: Get a lineup
        service: DirectorConsoleService.getLineup
        security: {
            policy: platform.view
        }
        response: {
            200: {
                application/json: Lineup
            }
        }
    }
    delete: { # Deletes a lineup. Answers 409 while it is on air: stop the station or put another one on first
        name: Delete a lineup
        service: DirectorConsoleService.deleteLineup
        security: {
            policy: platform.manage
        }
        response: {
            204:
        }
    }
}

operation /director/lineups/{lineupId}/extend: {
    params: {
        lineupId: string(min=1, max=100)
    }
    post: { # Queues a refill and returns at once. Generating a set walks the catalog, and an operator pressing a button should not be held open through it
        name: Extend a lineup
        service: DirectorConsoleService.extendLineup
        security: {
            policy: platform.manage
        }
        request: {
            application/json: ExtendLineupInput
        }
        response: {
            202:
        }
    }
}

operation /director/lineups/{lineupId}/shuffle: {
    params: {
        lineupId: string(min=1, max=100)
    }
    post: { # Shuffles everything not yet committed. The head is already in the player's hands and is left alone
        name: Shuffle a lineup
        service: DirectorConsoleService.shuffleLineup
        security: {
            policy: platform.manage
        }
        request: {
            application/json: EditLineupInput
        }
        response: {
            200: {
                application/json: Lineup
            }
        }
    }
}

operation /director/lineups/{lineupId}/segments: {
    params: {
        lineupId: string(min=1, max=100)
    }
    post: { # Puts something the station says into the order at a position. A segment with no audio yet is refused here rather than accepted and skipped at the boundary, so an operator is told why it cannot play
        name: Add a segment to a lineup
        service: DirectorConsoleService.addSegment
        security: {
            policy: platform.manage
        }
        request: {
            application/json: AddLineupSegmentInput
        }
        response: {
            200: {
                application/json: Lineup
            }
        }
    }
}

operation /director/lineups/{lineupId}/items/{itemId}: {
    params: {
        lineupId: string(min=1, max=100)
        itemId: string(min=1, max=100)
    }
    patch: { # Moves a line. A position at or before the cursor is refused rather than clamped: that part of the order is already committed
        name: Move a lineup item
        service: DirectorConsoleService.moveItem
        security: {
            policy: platform.manage
        }
        request: {
            application/json: MoveLineupItemInput
        }
        response: {
            200: {
                application/json: Lineup
            }
        }
    }
    delete: { # Drops a line that has not been committed yet
        name: Remove a lineup item
        service: DirectorConsoleService.removeItem
        security: {
            policy: platform.manage
        }
        query: EditLineupInput
        response: {
            200: {
                application/json: Lineup
            }
        }
    }
}
