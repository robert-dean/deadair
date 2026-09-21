options {
    keys: {
        area: personas
    }
    services: {
        PersonasService: "#src/modules/personas/personas.service.js"
        PersonaExportService: "#src/modules/personas/persona.export.service.js"
        PersonaImportService: "#src/modules/personas/persona.import.service.js"
        PersonaRehearsalService: "#src/modules/personas/persona.rehearsal.service.js"
        PersonaNotesService: "#src/modules/personas/persona.notes.service.js"
        PersonaStoriesService: "#src/modules/personas/persona.stories.service.js"
        PersonaMemoryService: "#src/modules/personas/persona.memory.service.js"
    }
    security: {
        # The floor for this file is the WRITE end, unlike settings beside it, because this file is
        # one read and four writes: a route added here without a block of its own is far more likely
        # to be another write, and inheriting the tighter gate is the failure that gets reported
        # rather than the one that goes quiet. The single read overrides it downward.
        policy: platform.manage
    }
}

# Every mutation answers the whole list rather than the row it touched. Making one persona the
# station's host takes that off another, deleting one can leave the station with no host at all, and
# `presenting` is derived per answer, so a caller that got back only the row it named would be
# holding a list it has to refetch anyway.

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

# A character as a file, so it can be kept, edited by hand, or sent to somebody running their own
# station. The whole roster or one of them; the same shape either way, so a file is a file.
#
# It carries no id and no `defaultHost`, which is not a decision made here: the file's persona is
# `PersonaDraftView`, whose two absent fields are exactly those, so importing one can never change
# who is on air and can never collide with a row it did not mean. What identifies a character across
# two installs is its `key`.
operation /personas/export: {
    get: { # Every character this station holds, as one file
        name: Export personas
        security: {
            # The read floor, as the persona list beside it: a character is prose the console already
            # shows in full, and a file of them carries no credential and no station secret. This is
            # the whole difference from the wider export in [backup-and-restore](https://github.com/robert-dean/deadair/discussions/6), which
            # sits on `platform.manage` because it names which secrets are set.
            policy: platform.view
        }
        service: PersonaExportService.exportPersonas
        response: {
            200: {
                application/json: PersonaFile
                headers: {
                    Content-Disposition?: string
                }
            }
        }
    }
}

operation /personas/{id}/export: {
    params: {
        id: string(min=1, max=100)
    }
    get: { # One character, its sheet and its stories, as a file
        name: Export persona
        security: {
            policy: platform.view
        }
        service: PersonaExportService.exportPersona
        response: {
            200: {
                application/json: PersonaFile
                headers: {
                    Content-Disposition?: string
                }
            }
            404:
        }
    }
}

# What a file WOULD do here, written nowhere.
#
# Its own verb rather than a `dryRun` flag on the import, and the two call one planner so "the same
# code path" is still literally true. What two verbs buy is the console: it can preview the moment a
# file is chosen and offer Import as a second, deliberate act, rather than making an operator opt out
# of writing.
#
# What the preview is FOR is the half a file cannot answer for itself. Which characters are new here
# and which would be rewritten is one; the other is the four things this station may not be able to
# honour — a voice its engine does not map, a soundboard it does not hold, a phrasing naming a value
# it cannot fill, and markers the character's own sample lines never use. None of them refuses an
# import, and every one of them is otherwise found out by putting the character on air.
operation /personas/import/preview: {
    post: { # Reads a file and reports what importing it would create, rewrite and skip. Writes nothing
        name: Preview persona import
        service: PersonaImportService.preview
        request: {
            application/json: PersonaFile
        }
        response: {
            200: {
                application/json: PersonaImportPlan
            }
        }
    }
}

# Takes a file in. MERGE: a character this station holds under the same key has its sheet rewritten
# and its stories added to, and one it does not is created. Nothing is ever deleted — a story the
# operator here wrote and the file has never heard of stays exactly where it is.
#
# It puts NOBODY on air, and needs no way to: `PUT /personas/{id}/default-host` is the one path, and it
# already tells the show that is running. So an imported character arrives beside the others and
# takes over when somebody says so.
#
# All or nothing. The preview above is what stands between an operator and a surprise, so a file that
# landed half way would be the one outcome nothing had described.
operation /personas/import: {
    post: { # Writes a file into this station, merging by key, and answers with what it did
        name: Import personas
        service: PersonaImportService.import
        request: {
            application/json: PersonaFile
        }
        response: {
            200: {
                application/json: PersonaImportResult
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

# The station's OWN host, which is not the same as who is on air: a broadcast that named its own host
# keeps it, and this is who presents once that show ends. `PersonaList.presenting` is the other
# question, and `POST /director/recast` is what changes who is speaking right now.
operation /personas/{id}/default-host: {
    params: {
        id: string(min=1, max=100)
    }
    put: { # Makes this persona the station's own host, and the previous one no longer is
        name: Set the station host
        service: PersonasService.setDefaultHost
        response: {
            200: {
                application/json: PersonaList
            }
        }
    }
}

# What this character has accumulated beyond its sheet.
#
# Every mutation answers the whole notebook, on this file's own rule one level down: accepting a
# proposal moves one row between two sections of the same panel, and a caller handed back only the row
# it named holds a list it has to refetch anyway.
#
# The READ is `platform.view` like the persona list beside it, because a notebook is part of reading
# the station. Everything else inherits the file's `platform.manage` floor.
operation /personas/{id}/notes: {
    params: {
        id: string(min=1, max=100)
    }
    get: { # Everything this character has accumulated, oldest first, in every state
        name: List persona notes
        service: PersonaNotesService.list
        security: {
            policy: platform.view
        }
        response: {
            200: {
                application/json: PersonaNoteList
            }
        }
    }
    post: { # Writes a note by hand. An operator's own note is active from the moment it exists; only the distil pass proposes
        name: Write persona note
        service: PersonaNotesService.create
        request: {
            application/json: PersonaNoteWrite
        }
        response: {
            201: {
                application/json: PersonaNoteList
            }
        }
    }
}

operation /personas/{id}/notes/{noteId}: {
    params: {
        id: string(min=1, max=100)
        noteId: string(min=1, max=100)
    }
    put: { # Rewrites one note's words, whoever wrote it. Editing what the station proposed is most of the point of the panel
        name: Update persona note
        service: PersonaNotesService.update
        request: {
            application/json: PersonaNoteWrite
        }
        response: {
            200: {
                application/json: PersonaNoteList
            }
        }
    }
    delete: { # Removes a note outright. Turning down a PROPOSAL is a state rather than this, or the next pass writes it again
        name: Delete persona note
        service: PersonaNotesService.remove
        response: {
            200: {
                application/json: PersonaNoteList
            }
        }
    }
}

operation /personas/{id}/notes/{noteId}/state: {
    params: {
        id: string(min=1, max=100)
        noteId: string(min=1, max=100)
    }
    put: { # Accepts a proposal, turns one down, or rests an active note. Mirrors the lexicon's own state route
        name: Set persona note state
        service: PersonaNotesService.setState
        request: {
            application/json: PersonaNoteState
        }
        response: {
            200: {
                application/json: PersonaNoteList
            }
        }
    }
}

# What has happened to this character, which is the half of it that GROWS.
#
# The same shape as the notebook above, one table over, and every mutation answers the whole shelf for
# the same reason: accepting a proposal moves a row between two sections of one panel.
#
# A story carries DETAILS, which is why there is a fourth level of path here where the notebook stops
# at three. A detail is turned down without touching the story it was hung on, and that is the whole
# argument for it being a row rather than a rewrite of the telling.
operation /personas/{id}/stories: {
    params: {
        id: string(min=1, max=100)
    }
    get: { # Every story this character holds, oldest first, in every state
        name: List persona stories
        service: PersonaStoriesService.list
        security: {
            policy: platform.view
        }
        response: {
            200: {
                application/json: PersonaStoryList
            }
        }
    }
    post: { # Writes a story by hand. An operator's own is tellable from the moment it exists; only the enrichment pass proposes
        name: Write persona story
        service: PersonaStoriesService.create
        request: {
            application/json: PersonaStoryWrite
        }
        response: {
            201: {
                application/json: PersonaStoryList
            }
        }
    }
}

operation /personas/{id}/stories/{storyId}: {
    params: {
        id: string(min=1, max=100)
        storyId: string(min=1, max=100)
    }
    put: { # Rewrites one story's handle and telling, whoever wrote it
        name: Update persona story
        service: PersonaStoriesService.update
        request: {
            application/json: PersonaStoryWrite
        }
        response: {
            200: {
                application/json: PersonaStoryList
            }
        }
    }
    delete: { # Removes a story outright, details and all. Turning down a PROPOSAL is a state rather than this, or the next pass writes it again
        name: Delete persona story
        service: PersonaStoriesService.remove
        response: {
            200: {
                application/json: PersonaStoryList
            }
        }
    }
}

operation /personas/{id}/stories/{storyId}/state: {
    params: {
        id: string(min=1, max=100)
        storyId: string(min=1, max=100)
    }
    put: { # Accepts a proposal, turns one down, or takes a story out of the rotation without losing it
        name: Set persona story state
        service: PersonaStoriesService.setState
        request: {
            application/json: PersonaStoryState
        }
        response: {
            200: {
                application/json: PersonaStoryList
            }
        }
    }
}

operation /personas/{id}/stories/{storyId}/details: {
    params: {
        id: string(min=1, max=100)
        storyId: string(min=1, max=100)
    }
    post: { # Adds one thing to a story that already exists
        name: Add persona story detail
        service: PersonaStoriesService.addDetail
        request: {
            application/json: PersonaStoryDetailWrite
        }
        response: {
            201: {
                application/json: PersonaStoryList
            }
        }
    }
}

operation /personas/{id}/stories/{storyId}/details/{detailId}: {
    params: {
        id: string(min=1, max=100)
        storyId: string(min=1, max=100)
        detailId: string(min=1, max=100)
    }
    put: { # Rewrites one detail's words
        name: Update persona story detail
        service: PersonaStoriesService.updateDetail
        request: {
            application/json: PersonaStoryDetailWrite
        }
        response: {
            200: {
                application/json: PersonaStoryList
            }
        }
    }
    delete: { # Removes one detail, leaving the story it was hung on alone
        name: Delete persona story detail
        service: PersonaStoriesService.removeDetail
        response: {
            200: {
                application/json: PersonaStoryList
            }
        }
    }
}

operation /personas/{id}/stories/{storyId}/details/{detailId}/state: {
    params: {
        id: string(min=1, max=100)
        storyId: string(min=1, max=100)
        detailId: string(min=1, max=100)
    }
    put: { # Accepts a proposed detail or turns it down, which has to outlive the pass that proposed it
        name: Set persona story detail state
        service: PersonaStoriesService.setDetailState
        request: {
            application/json: PersonaStoryState
        }
        response: {
            200: {
                application/json: PersonaStoryList
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

# The parts an ARC is told in. Its own routes rather than a mode of the details above, because the
# two are different things: a detail is something the story picked up and every active one is shown
# at once, while a beat is one telling's worth and exactly one is ever shown. See
# `persona.story.beat.ts`.
operation /personas/{id}/stories/{storyId}/beats: {
    params: {
        id: string(min=1, max=100)
        storyId: string(min=1, max=100)
    }
    post: { # Adds one part to an arc. A script rather than a summary: the floor speaks it as it stands
        name: Add persona story beat
        service: PersonaStoriesService.addBeat
        request: {
            application/json: PersonaStoryBeatWrite
        }
        response: {
            201: {
                application/json: PersonaStoryList
            }
        }
    }
}

operation /personas/{id}/stories/{storyId}/beats/{beatId}: {
    params: {
        id: string(min=1, max=100)
        storyId: string(min=1, max=100)
        beatId: string(min=1, max=100)
    }
    put: { # Rewrites one part's words, or moves it in the order
        name: Update persona story beat
        service: PersonaStoriesService.updateBeat
        request: {
            application/json: PersonaStoryBeatWrite
        }
        response: {
            200: {
                application/json: PersonaStoryList
            }
        }
    }
    delete: { # Removes one part outright, leaving the arc standing. Turning down a PROPOSAL is a state instead
        name: Delete persona story beat
        service: PersonaStoriesService.removeBeat
        response: {
            200: {
                application/json: PersonaStoryList
            }
        }
    }
}

operation /personas/{id}/stories/{storyId}/beats/{beatId}/state: {
    params: {
        id: string(min=1, max=100)
        storyId: string(min=1, max=100)
        beatId: string(min=1, max=100)
    }
    put: { # Accepts a proposed part, or turns it down without losing that it was turned down
        name: Set persona story beat state
        service: PersonaStoriesService.setBeatState
        request: {
            application/json: PersonaStoryState
        }
        response: {
            200: {
                application/json: PersonaStoryList
            }
        }
    }
}

# Undoing what a character accumulated on its own.
#
# A station whose characters grow unattended needs a way back, or every experiment is permanent and
# the only safe setting is off. What this undoes is what the STATION accrued — tellings, and anything
# the nightly passes proposed — and never what an operator wrote by hand.
#
# The two READS are `platform.view` like the notebook and the shelf beside them, because looking at
# what a character has said is part of reading the station. The rollback itself inherits the file's
# `platform.manage` floor, because it is the most destructive thing in this file.
operation /personas/{id}/memory: {
    params: {
        id: string(min=1, max=100)
    }
    get: { # What this character has told, newest first. The timeline a moment is picked from
        name: Read persona memory
        service: PersonaMemoryService.timeline
        security: {
            policy: platform.view
        }
        response: {
            200: {
                application/json: PersonaMemoryTimeline
            }
        }
    }
}

operation /personas/{id}/memory/preview: {
    params: {
        id: string(min=1, max=100)
    }
    get: { # What rolling back to a moment would undo, without undoing it
        name: Preview persona memory rollback
        service: PersonaMemoryService.preview
        security: {
            policy: platform.view
        }
        query: {
            to?: string(max=40) # The moment to go back to, as a timeline row reports it. Absent counts all of it, which is what a reset would take
        }
        response: {
            200: {
                application/json: PersonaMemoryChange
            }
        }
    }
}

operation /personas/{id}/memory/rollback: {
    params: {
        id: string(min=1, max=100)
    }
    post: { # Undo it. Everything the station accrued after that moment goes; everything an operator wrote stays
        name: Roll back persona memory
        service: PersonaMemoryService.rollback
        request: {
            application/json: PersonaMemoryRollback
        }
        response: {
            200: {
                application/json: PersonaMemory
            }
        }
    }
}
