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
#
# NOTE ON THE COMMENTS IN THIS FILE. Everything below has to live in this block, at the top, rather
# than beside the thing it explains. The prettier plugin DELETES a comment inside a `security { }`
# or `response { }` body on the next `pnpm format`, silently and without touching the surrounding
# lines, so a note written where it belongs is gone by the following commit.
#
# The security cascade, file -> route -> operation:
#   * the floor above is `platform.view`, because reading the library is a console read
#   * POST /segments/scan overrides UP to `platform.manage`: taking audio off disk into the
#     station's library is an operator action
#   * GET /segments/{id}/audio overrides to anonymous, for the same reason /art/{id} is. That URL
#     is the src of a media element and a media request carries no bearer token; and it is the URL
#     the PLAYER fetches (see the segment resolver in modules/playout), which cannot send headers
#     of ours at all. What it exposes is audio the station broadcasts unauthenticated to anybody
#     who opens the mount.
#
# Why the audio operation declares one mime, and why the store therefore holds exactly one format:
# the generated router pins `ctx.type` from that line, AFTER setting the response headers, so a
# service cannot vary it per file. Both consumers decide what to do with the bytes from that
# header — a browser's <audio> does not sniff the way an <img> does, and Liquidsoap names the temp
# file it downloads to after the content type and picks its decoder from that. See the note on
# SEGMENT_EXTENSIONS in modules/render/segment.store.ts.

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
                audio/mpeg: binary
                headers: {
                    cache-control?: string
                    etag?: string
                }
            }
            304:
        }
    }
}