options {
    keys: {
        area: art
    }
    services: {
        ArtService: "#src/modules/art/art.service.js"
        ArtSourceService: "#src/modules/art/art.source.service.js"
    }
}

# Locally cached artwork, served by the station instead of hotlinked from whichever CDN the catalog
# happens to point at. Its own area rather than an operation under /catalog: the store is a generic
# asset seam that catalog rows reference, and the code behind it lives in modules/art.
#
# The operation is anonymous by necessity: this URL is the src of an <img>, and an image request
# carries no bearer token. What it exposes is a cover the catalog already points the console at.
#
# That note lives up HERE for historical reasons: the formatter used to delete a comment written
# inside or immediately above a `security` block, and had already done so once. Fixed in core 0.26 —
# a note above `security: none` round-trips now and would be the better home for it.

# A cover the station has not cached yet, served as its own. Every read reports such a cover as
# `art/source/<token>` rather than as the provider's URL, which can carry a credential (a Subsonic
# cover link holds the operator's user and token). The token is that URL sealed with a key only the
# station holds, so it cannot be read back out of the path, and one the station did not mint answers
# 404. The first request fetches the cover into the store; later reads report the plain `art/{id}`.
#
# Declared before /art/{id} so the literal `source` segment is matched first: `/art/source/<token>`
# also has the shape of `/art/{id}/{filename}`, whose uuid check would answer 400.
operation /art/source/{token}: {
    params: {
        token: string(min=24, max=4096)
    }
    get: { # The bytes of a cover the station fetches on first ask, addressed by its sealed source
        name: Get source art
        service: ArtSourceService.getSourceArt
        security: none
        response: {
            200: {
                image/jpeg: binary
                image/png: binary
                image/webp: binary
                image/gif: binary
                headers: {
                    cache-control?: string
                    etag?: string
                }
            }
            304:
        }
    }
}

# The same under a filename, for the player that decides by the URL (see /art/{id}/{filename}). The
# mount's cover for a record whose art is still upstream is this shape.
operation /art/source/{token}/{filename}: {
    params: {
        token: string(min=24, max=4096)
        filename: string(min=3, max=64)
    }
    get: { # The bytes of a cover the station fetches on first ask, under any filename
        name: Get source art file
        service: ArtSourceService.getSourceArtFile
        security: none
        response: {
            200: {
                image/jpeg: binary
                image/png: binary
                image/webp: binary
                image/gif: binary
                headers: {
                    cache-control?: string
                    etag?: string
                }
            }
            304:
        }
    }
}

operation /art/{id}: {
    params: {
        id: uuid
    }
    get: { # The bytes of one cached image, addressed by its id alone
        name: Get art
        service: ArtService.getArt
        security: none
        response: {
            200: {
                # Every format the store holds, rather than one octet-stream standing in for all of
                # them. The service returns `contentType` and the router sets ctx.type from it.
                #
                # This used to be a single declared mime because the router pinned ctx.type from
                # the contract and a service could not vary it per file. That was survivable only
                # because a browser sniffs an <img>: the header was wrong and the image rendered
                # anyway. It also meant this API could never send X-Content-Type-Options: nosniff
                # without breaking art. Both of those are now gone.
                image/jpeg: binary
                image/png: binary
                image/webp: binary
                image/gif: binary
                headers: {
                    cache-control?: string
                    etag?: string
                }
            }
            # Documented rather than produced here: the conditional-GET middleware turns a fresh
            # 200 carrying an ETag into one. A bare status says exactly that, so the service is not
            # asked to return it.
            304:
        }
    }
}

# The same image under a filename, for a client that decides whether a URL is a picture by looking
# at the URL. A hardware player handed an artwork link in a stream's metadata is the case in hand:
# it fetches a link ending in `.jpg` and ignores one that ends in an id, without ever asking.
#
# The bytes are chosen by `id`; `filename` is decoration and the station does not read it. So the
# extension somebody writes there is a request for a shape rather than for a format, and the
# response says what the image really is in its own content type, exactly as the route above does.

operation /art/{id}/{filename}: {
    params: {
        id: uuid
        filename: string(min=3, max=64)
    }
    get: { # The bytes of one cached image, under any filename
        name: Get art file
        service: ArtService.getArtFile
        security: none
        response: {
            200: {
                image/jpeg: binary
                image/png: binary
                image/webp: binary
                image/gif: binary
                headers: {
                    cache-control?: string
                    etag?: string
                }
            }
            304:
        }
    }
}
