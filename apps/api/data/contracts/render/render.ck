options {
    keys: {
        area: render
    }
    services: {
        RenderService: "#src/modules/render/render.service.js"
    }
    security: {
        policy: platform.view
    }
}

# Segments: the things the station plays that are not records. An ident, a stinger, a talk break,
# later a whole show episode. Its own area rather than an operation under /playout, because the
# running order merely NAMES one: a segment exists, and is worth keeping, whether or not any lineup
# currently holds it.

# The POST writes a `planned` row and sends `render.segment` to speak it, so it answers as soon as
# the row exists rather than waiting on a synthesis. The segment comes back in the state it is
# actually in, which is `planned` every time: a caller polls the GET to watch it reach `ready`, and
# one that never gets there is skipped by the director rather than airing as silence.
#
# It takes platform.manage rather than the file's platform.view floor, because planning a segment is
# an operator action that spends somebody else's compute. That rationale lives out here because the
# formatter used to eat comments inside a `security` block; since core 0.26 it does not, and the
# note could sit on the POST's own `security:` instead.
operation /segments: {
    get: { # Everything the station can play that is not a record
        name: List segments
        service: RenderService.listSegments
        response: {
            200: {
                application/json: SegmentList
            }
        }
    }
    post: { # Plans something for the station to say, and starts rendering it
        name: Create segment
        service: RenderService.createSegment
        security: {
            policy: platform.manage
        }
        request: {
            application/json: SegmentCreate
        }
        response: {
            201: {
                application/json: Segment
            }
        }
    }
}

operation /segments/scan: {
    post: { # Takes whatever audio is sitting in the inbox directory into the library. Safe to repeat: a segment is identified by its audio, so the same recording arriving twice is one segment
        name: Scan the segment inbox
        service: RenderService.scanLibrary
        security: {
            policy: platform.manage
        }
        response: {
            200: {
                application/json: SegmentScanResult
            }
        }
    }
}

# Everything the station has ever written, including what it decided not to say.
#
# One row per write ATTEMPT rather than per break, so a model that declined and the floor that
# covered for it are two entries. Read-only and it stays that way: this is the record of what
# happened, and a record somebody can edit is not one.
#
# `platform.view` like the rest of the file, on the activity feed's argument: every field here is
# the station's own writing about its own records. The one thing that is not is `prompt` and `raw`,
# which are the station's own prompt and the model's answer to it, written only while
# `llm.captureWrites` is on and still nobody else's text.
operation /scripts: {
    get: { # What the station has written lately, newest first, one page at a time
        name: Read script history
        service: RenderService.readScriptHistory
        query: ScriptHistoryQuery
        response: {
            200: {
                application/json: ScriptHistoryPage
            }
        }
    }
}

# The roster's view of the same table `/scripts` pages through: every write attempt in a recent
# window, counted by outcome per presenter.
#
# It lives beside the history rather than with the personas because this is the render module's
# table and a personas-area service reaching into it would invert who owns the rows. What reads it
# is a page about characters; what holds it is the record of what was written.
#
# One row per persona that ATTEMPTED anything, plus one keyless row for the attempts made while
# nobody was presenting, which is an ordinary state — leaving it out would make these counts
# irreconcilable with the page next door. A persona that has written nothing has no row at all,
# because the table cannot report what is not in it, and the console already holds the roster.
# What the operator thought of one attempt.
#
# A PUT rather than a POST because one station holds one opinion per attempt: saying it again
# replaces it rather than accumulating a history of moods, which is what the table's primary key
# enforces underneath.
#
# It rates the ATTEMPT rather than the break, the persona or the phrasing, so the floor's own lines
# can be judged as well as the model's — every narrower verdict is a group over rows that already
# carry all four.
operation /scripts/{id}/rating: {
    params: {
        id: uuid
    }
    put: { # What the operator thought of this attempt. Nothing acts on it automatically
        name: Rate script
        service: RenderService.rateScript
        security: {
            # Reading back what the station wrote is a view; having an opinion about it is an
            # operator action, so this takes `platform.manage` rather than the file's read floor.
            # The three catalog rating verbs override their own file's floor the same way.
            policy: platform.manage
        }
        request: {
            application/json: ScriptRatingInput
        }
        response: {
            200: {
                application/json: ScriptAttempt
            }
        }
    }
}

operation /scripts/summary: {
    get: { # Write attempts by outcome, per presenter, over a recent window
        name: Read script summary
        service: RenderService.readScriptSummary
        query: ScriptHistorySummaryQuery
        response: {
            200: {
                application/json: ScriptHistorySummary
            }
        }
    }
}

operation /voices: {
    get: { # The voices the station can be asked to speak in
        name: List voices
        service: RenderService.listVoices
        response: {
            200: {
                application/json: VoiceList
            }
        }
    }
}

# The same sample, for the voice the plugin uses when nothing names one.
#
# A route of its own because the id of that voice is the EMPTY STRING — that is what an absent
# `segments.voice` means and what the plugin's own list calls `Default` — and a path segment cannot
# be empty: `/voices//sample` is not the sample route with a blank id, it is a URL that matches
# nothing, which is why the one row on the voices page an operator is most likely to press first
# answered 404 for as long as the page has existed.
#
# A reserved word in the path was the alternative and was rejected: a station voice is whatever the
# operator called it in the plugin's own table, so any word this reserved could be one they had
# already used.
operation /voices/sample: {
    get: { # A short line spoken in whichever voice the plugin falls back to
        name: Get default voice sample
        service: RenderService.getDefaultVoiceSample
        response: {
            200: {
                audio/mpeg: binary
                audio/wav: binary
                audio/ogg: binary
                audio/flac: binary
                audio/mp4: binary
                headers: {
                    cache-control?: string
                    etag?: string
                }
            }
            # As the route below, and produced the same way: by the conditional-GET middleware from
            # the ETag rather than by the service.
            304:
        }
    }
}

# A preview, never something that can air: samples live in their own store, have no row in
# `deadair.segments`, and so cannot be planted by the break planner or named by a lineup.
#
# Rendered on the first ask and cached under a key derived from the plugin, the voice and the fixed
# sample line, so remapping a voice mints a new key rather than serving the old one back. The first
# click therefore waits for a synthesis and no later one does.
#
# Unlike `/segments/{id}/audio` this is NOT anonymous: that route is open because Liquidsoap fetches
# it, and nothing but a signed-in operator ever fetches this. The console reads it through the SDK
# and plays a blob, because a bearer token cannot ride on an <audio src>.
operation /voices/{voiceId}/sample: {
    params: {
        voiceId: string
    }
    get: { # A short line spoken in one voice, so an operator can hear it before choosing it
        name: Get voice sample
        service: RenderService.getVoiceSample
        response: {
            200: {
                audio/mpeg: binary
                audio/wav: binary
                audio/ogg: binary
                audio/flac: binary
                audio/mp4: binary
                headers: {
                    cache-control?: string
                    etag?: string
                }
            }
            # As the segment audio route: produced by the conditional-GET middleware from the ETag
            # rather than by the service, so it is documented here and not returned there.
            304:
        }
    }
}

# A rehearsal, heard. The sample route above with the caller's own words in place of the fixed line:
# rendered through the same store, so it has no row in `deadair.segments` and cannot be planted or
# named by a lineup, and cached under a key that includes the text, so replaying one line is free.
#
# A POST rather than a GET because it can spend a synthesis and a script does not belong in a URL,
# where it would land in every access log between here and the browser. `platform.manage` for the
# first of those reasons: this is an operator action that costs somebody's compute, like planning a
# segment.
operation /voices/preview: {
    post: { # Speaks the caller's words in one voice, so a break can be heard before it is written for air
        name: Preview speech
        security: {
            policy: platform.manage
        }
        service: RenderService.previewSpeech
        request: {
            application/json: SpeechPreviewRequest
        }
        response: {
            200: {
                audio/mpeg: binary
                audio/wav: binary
                audio/ogg: binary
                audio/flac: binary
                audio/mp4: binary
            }
        }
    }
}

operation /segments/{id}/audio: {
    params: {
        id: uuid
    }
    get: { # The audio of one segment
        name: Get segment audio
        service: RenderService.getSegmentAudio
        security: none
        response: {
            200: {
                # Every format the segment store holds. The service returns `contentType` and the
                # router sets ctx.type from it, so the station can serve a wav as a wav rather than
                # announcing one mime for all of them and hoping the consumer sniffs. Neither
                # consumer does: a browser's <audio> is stricter than an <img>, and Liquidsoap
                # names the temp file it downloads to after the content type and picks its decoder
                # from the name.
                audio/mpeg: binary
                audio/wav: binary
                audio/ogg: binary
                audio/flac: binary
                audio/mp4: binary
                headers: {
                    cache-control?: string
                    etag?: string
                }
            }
            # Documented rather than produced here: the conditional-GET middleware turns a fresh
            # 200 carrying an ETag into one. A bare status says exactly that, so the service is
            # not asked to return it.
            304:
        }
    }
}

# One blob in the segment store, by its own checksum.
#
# This exists for the JOIN. A padded break is several takes of speech with a soundboard hit between
# them, and the mixer is handed URLs rather than bytes -- so every part has to be fetchable from a
# sidecar container. A production's beats already are, because a beat is a segment with an id; a TAKE
# is not a segment and never will be, and neither is a pad.
#
# So this addresses the store the way the store addresses itself. It serves takes and pads through
# one operation rather than two because both are the same thing at this layer: bytes under a
# checksum. Which of them a caller wanted is a question the row answers, and no row is involved here.
#
# `security: none` for `/segments/{id}/audio`'s reason exactly -- the thing fetching it is a mixer in
# another container with no session -- and the exposure is narrower than that route's, because a
# checksum cannot be guessed or enumerated where a uuid at least appears in the console's own JSON.
#
# The extension is its own path segment rather than a suffix on the checksum, because the DSL binds
# one parameter per segment. It is needed at all because the store files bytes under `<checksum>.<ext>`
# and cannot find them from the hash alone.
operation /audio/{checksum}/{ext}: {
    params: {
        checksum: string(min=64, max=64)
        ext: string(min=1, max=8)
    }
    get: { # Audio out of the segment store, addressed by content rather than by row
        name: Get stored audio
        service: RenderService.getStoredAudio
        security: none
        response: {
            200: {
                audio/mpeg: binary
                audio/wav: binary
                audio/ogg: binary
                audio/flac: binary
                audio/mp4: binary
                headers: {
                    cache-control?: string
                    etag?: string
                }
            }
            # Content-addressed, so the bytes under a checksum are the same bytes forever and a
            # conditional GET can always be answered. Produced by the middleware, as above.
            304:
        }
    }
}

# How the station says a word.
#
# This was `render.pronunciations`, a `written => spoken` text setting, and it left the settings form
# for the reason the format clock did: an entry that arrives from somewhere carries the article it
# came from and the sentence that says so, it can be turned down in a way that has to outlive the
# next mining pass, and none of the three fit on a line with an arrow in the middle of it.
#
# Every mutation answers the WHOLE list rather than the row it touched, as the personas file does:
# accepting a proposal is one row moving between two sections of the same page, and a caller handed
# back only what it named is holding a list it has to refetch anyway.
operation /pronunciations: {
    get: { # The station's lexicon: what it says, what has been proposed to it, and what it has turned down
        name: List pronunciations
        service: RenderService.listPronunciations
        query: PronunciationQuery
        response: {
            200: {
                application/json: PronunciationList
            }
        }
    }
    post: { # Adds one the operator typed. It is said from the next render on
        name: Create pronunciation
        service: RenderService.createPronunciation
        security: {
            policy: platform.manage
        }
        request: {
            application/json: PronunciationWrite
        }
        response: {
            201: {
                application/json: PronunciationList
            }
        }
    }
}

operation /pronunciations/{id}: {
    params: {
        id: uuid
    }
    put: { # Rewrites one entry's words, whoever proposed it
        name: Update pronunciation
        service: RenderService.updatePronunciation
        security: {
            policy: platform.manage
        }
        request: {
            application/json: PronunciationWrite
        }
        response: {
            200: {
                application/json: PronunciationList
            }
        }
    }
    delete: { # Removes an entry outright. Turning a PROPOSAL down is a state rather than a deletion, because a deleted one comes back on the next pass
        name: Delete pronunciation
        service: RenderService.deletePronunciation
        security: {
            policy: platform.manage
        }
        response: {
            200: {
                application/json: PronunciationList
            }
        }
    }
}

operation /pronunciations/{id}/state: {
    params: {
        id: uuid
    }
    put: { # Accepts a proposal, turns one down, or takes an entry out of use without losing what it said
        name: Set pronunciation state
        service: RenderService.setPronunciationState
        security: {
            policy: platform.manage
        }
        request: {
            application/json: PronunciationStateWrite
        }
        response: {
            200: {
                application/json: PronunciationList
            }
        }
    }
}

# The soundboard: the short sounds a presenter reaches for.
#
# Its own routes rather than a filter on `/segments`, because a pad is deliberately not a segment --
# a segment is one airable element and an air horn is not one, which is why `readyKinds` would
# otherwise offer "air horn" as a bookable clock band. See migration 0023.
#
# There is no create and no delete. A pad arrives by being dropped in `media/pads/<board>/`,
# which is how the station already takes delivery of audio, and it leaves by being REJECTED rather
# than removed: the scan re-reads that directory, so a deleted row would be back on the next pass.
operation /pads: {
    get: { # Every sound the station holds, board by board
        name: List pads
        security: {
            policy: platform.view
        }
        service: RenderService.listPads
        response: {
            200: {
                application/json: PadList
            }
        }
    }
}

operation /pads/scan: {
    post: { # Takes whatever audio is sitting in the pad library directory onto its board. Safe to repeat: a file nobody has touched is seen and left alone
        name: Scan the pad library
        security: {
            policy: platform.manage
        }
        service: RenderService.scanPads
        response: {
            200: {
                application/json: PadScanResult
            }
        }
    }
}

operation /pads/{id}/state: {
    params: {
        id: uuid
    }
    put: { # Turns a sound down, or puts one back. Answers the whole rack, since one pad changing state is one row moving between two sections of the same page
        name: Set pad state
        security: {
            policy: platform.manage
        }
        service: RenderService.setPadState
        request: {
            application/json: PadState
        }
        response: {
            200: {
                application/json: PadList
            }
        }
    }
}

operation /pads/{id}/audio: {
    params: {
        id: uuid
    }
    get: { # The sound itself, so an operator can hear what they dropped in
        name: Get pad audio
        service: RenderService.getPadAudio
        security: none
        response: {
            200: {
                audio/mpeg: binary
                audio/wav: binary
                audio/ogg: binary
                audio/flac: binary
                audio/mp4: binary
                headers: {
                    cache-control?: string
                    etag?: string
                }
            }
            304:
        }
    }
}

# The sets over the pad library: what a presenter is actually handed.
#
# Every mutation answers the WHOLE rack, as the pronunciations routes do and for their reason: one
# pad moving between two sets changes two rows of the same page, and a caller handed only what it
# named is holding a list it has to refetch anyway.
#
# There is no create-from-nothing shortcut on the directory side, deliberately: a scan makes the set
# named after a folder, and this is for the sets an operator builds ACROSS folders
operation /pads/sets: {
    post: { # Names a new set, or answers the one already under that key
        name: Create pad set
        security: {
            policy: platform.manage
        }
        service: RenderService.createPadSet
        request: {
            application/json: PadSetWrite
        }
        response: {
            200: {
                application/json: PadList
            }
        }
    }
}

operation /pads/sets/{id}: {
    params: {
        id: uuid
    }
    put: { # Renames a set. The KEY moves with it, so every persona naming the old one stops finding it
        name: Update pad set
        security: {
            policy: platform.manage
        }
        service: RenderService.updatePadSet
        request: {
            application/json: PadSetWrite
        }
        response: {
            200: {
                application/json: PadList
            }
        }
    }
    delete: { # Removes a set and its memberships, and no pads at all
        name: Delete pad set
        security: {
            policy: platform.manage
        }
        service: RenderService.deletePadSet
        response: {
            200: {
                application/json: PadList
            }
        }
    }
}

operation /pads/sets/{id}/pads: {
    params: {
        id: uuid
    }
    put: { # Puts a pad on a set or takes it off. Refused where the set already answers to that name, because a script writes a name
        name: Set pad membership
        security: {
            policy: platform.manage
        }
        service: RenderService.setPadMembership
        request: {
            application/json: PadSetMembership
        }
        response: {
            200: {
                application/json: PadList
            }
        }
    }
}
