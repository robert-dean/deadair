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
