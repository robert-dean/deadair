options {
    keys: {
        area: settings
    }
    services: {
        SettingsService: "#src/modules/settings/settings.service.js"
        SigninProviderCheckService: "#src/modules/authentication/signin.provider.check.service.js"
    }
    security: {
        # The floor for every operation in this file. The READ end, deliberately, because this file
        # is one read and one write and the write overrides upward at its own verb. That is the
        # opposite of the plugins floor, and for the opposite reason: there is one write here, it is
        # named, and a route added without a block is far more likely to be another read.
        policy: platform.view
    }
}

# The station's own settings: what it is called, what puts it on air, what it speaks with. Not a
# plugin's configuration, which is the plugin's own surface and stored per plugin.
#
# There is no per-key route. A settings form is submitted as a form, and one route that takes a
# partial map is what lets the console send exactly what the operator touched — with the whole
# submission validated before any of it is written, so a refused value never leaves half a form
# applied.

operation /settings: {
    get: { # Every station setting, its descriptor and its current value
        name: Get settings
        service: SettingsService.read
        response: {
            200: {
                application/json: StationSettings
            }
        }
    }
    put: { # Applies a submitted settings form and answers with the settings as they now stand
        name: Update settings
        service: SettingsService.writeSubmitted
        security: {
            # Above the file's read floor: these are the operator's own knobs, and some of them
            # (the air mode above all) decide whether the station airs at all.
            policy: platform.manage
        }
        request: {
            application/json: StationSettingsInput
        }
        response: {
            200: {
                application/json: StationSettings
            }
        }
    }
}

operation /settings/signin/check: {
    get: { # Asks each identity provider in the sign-in settings for its discovery document, the way a sign-in would, and says which answered
        name: Check sign-in providers
        service: SigninProviderCheckService.check
        security: {
            # Above the read floor: every call reaches out to each issuer the operator listed, which
            # is an operator's action rather than a look at what is stored.
            policy: platform.manage
        }
        response: {
            200: {
                application/json: SigninProvidersCheck
            }
        }
    }
}
