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

operation /art/{id}: {
    params: {
        id: uuid
    }
    get: { # The bytes of one cached image
        name: Get art
        service: ArtService.getArt
        # Anonymous by necessity: this URL is the src of an <img>, and an image request carries no
        # bearer token. What it exposes is a cover the catalog already points the console at.
        security: none
        response: {
            # One declared mime for every format, because the generated router pins ctx.type from
            # this line and a service cannot vary it per file. Browsers sniff images in <img>
            # regardless; nothing in this API sends X-Content-Type-Options: nosniff, and adding it
            # would break art rendering until this becomes one operation per format.
            200: {
                application/octet-stream: binary
                headers: {
                    cache-control?: string
                    etag?: string
                }
            }
            # Declared for the SDK and the OpenAPI surface, not emitted here: the generated router
            # hardcodes the status of the first response with a body. The 304 is produced by the
            # conditional-GET middleware, which turns a fresh 200 carrying an ETag into one.
            304:
        }
    }
}
