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