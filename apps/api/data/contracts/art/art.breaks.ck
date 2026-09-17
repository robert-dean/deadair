options {
    keys: {
        area: art
    }
    services: {
        BreakArtworkService: "#src/modules/art/break.artwork.service.js"
    }
}

# The picture a KIND of break wears, which an operator can replace.
#
# Under /art rather than in a module of its own, because it IS art: the bytes sit in the same store,
# under the same content-addressed names, and are served by the two operations above with no idea
# they are anything unusual. What is different is only the key the row is filed under, which is the
# kind rather than an upstream URL -- see `modules/art/break.art.ts`.
#
# So there is no read operation here. The console draws `BreakArtwork.url`, which is an `art/<id>`
# path like any other, and a listener's player fetches the same one off the stream's artwork field.
#
# **Its own file because the ORDER these are mounted in is load-bearing.** `/art/breaks` also matches
# `/art/{id}` in `art.ck`, and `/art/breaks/{kind}` matches `/art/{id}/{filename}`; the id is a uuid,
# so the collision does not serve the wrong bytes -- it answers 400 and never reaches the operation
# below. Koa matches in the order routers are registered, so `ArtBreaksRouter` goes in FRONT of
# `ArtRouter` in `routes.setup.ts`, and `tests/routes/art.breaks.router.test.ts` pins it. One file
# per router is what makes that expressible at all.

operation /art/breaks: {
    get: { # Every kind the station holds a picture for
        name: List break artwork
        security: {
            # A read, so `platform.view`, which both roles grant. The BYTES are anonymous either way
            # -- this only says which kinds have any.
            policy: platform.view
        }
        service: BreakArtworkService.listBreaks
        response: {
            200: {
                application/json: BreakArtworkList
            }
        }
    }
}

operation /art/breaks/{kind}: {
    params: {
        kind: string(min=1, max=64)
    }

    post: { # Puts an operator's own picture behind a kind of break. The id does not change, so a URL already on the wire keeps working and the ETag is what says the picture moved
        name: Replace break artwork
        security: {
            policy: platform.manage
        }
        service: BreakArtworkService.replaceBreak
        request: {
            # The parts are documentation: a multipart body reaches the service as the raw parser
            # and the SDK types it as `FormData`, so nothing validates this shape.
            multipart/form-data: BreakArtworkUpload
        }
        response: {
            200: {
                application/json: BreakArtworkList
            }
            400:
            413:
            415:
        }
    }

    delete: { # Puts the picture this repository ships back. The shipped file is read at this moment rather than copied at install, so an upgrade that improved it is what comes back
        name: Revert break artwork
        security: {
            policy: platform.manage
        }
        service: BreakArtworkService.revertBreak
        response: {
            200: {
                application/json: BreakArtworkList
            }
            # Nothing is shipped for this kind, so there is no default to go back to. The operator's
            # own picture is left exactly where it is: a break with no picture at all would be a
            # silent change to what is on air.
            404:
        }
    }
}
