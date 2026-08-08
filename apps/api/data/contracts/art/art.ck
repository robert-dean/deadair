options {
    keys: {
        area: art
    }
    services: {
        ArtService: "#src/modules/art/art.service.js"
    }
}

# Locally cached artwork, served by the station instead of hotlinked from whichever CDN the catalog
# happens to point at. Its own area rather than an operation under /catalog: the store is a generic
# asset seam that catalog rows reference, and the code behind it lives in modules/art.
#
# The operation is anonymous by necessity: this URL is the src of an <img>, and an image request
# carries no bearer token. What it exposes is a cover the catalog already points the console at.
#
# That note lives up HERE rather than above the `security: none` line it explains, because the
# formatter deletes a comment written inside or immediately above a `security` block and it had
# already done so once. Comments inside `response` blocks round-trip; these do not. See the Gotchas
# in .claude/skills/contractkit/SKILL.md.

operation /art/{id}: {
    params: {
        id: uuid
    }
    get: { # The bytes of one cached image
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