options {
    keys: {
        area: art
    }
    services: {
        PersonaArtworkService: "#src/modules/art/persona.artwork.service.js"
    }
}

# A presenter's picture, which an operator puts on a persona and a listener's player shows.
#
# Under /art for `art.breaks.ck`'s reason: the bytes are served by `/art/{id}` like any cover, and only
# the key the row is filed under differs. Its own file for that file's other reason too: `/art/personas`
# also matches `/art/{id}`, so `ArtPersonasRouter` goes in front of `ArtRouter` in `routes.setup.ts`.

operation /art/personas: {
    get: { # Every persona that has a portrait
        name: List persona portraits
        security: {
            policy: platform.view
        }
        service: PersonaArtworkService.listPortraits
        response: {
            200: {
                application/json: PersonaPortraitList
            }
        }
    }
}

operation /art/personas/{personaId}: {
    params: {
        personaId: uuid
    }

    post: { # Puts a picture on a persona. A persona that already had one keeps its URL, so a player holding it picks up the new picture
        name: Replace persona portrait
        security: {
            policy: platform.manage
        }
        service: PersonaArtworkService.replacePortrait
        request: {
            multipart/form-data: PersonaPortraitUpload
        }
        response: {
            200: {
                application/json: PersonaPortraitList
            }
            400:
            413:
            415:
        }
    }

    delete: { # Takes a persona's picture away. A player shows the record's cover instead
        name: Remove persona portrait
        security: {
            policy: platform.manage
        }
        service: PersonaArtworkService.removePortrait
        response: {
            200: {
                application/json: PersonaPortraitList
            }
        }
    }
}
