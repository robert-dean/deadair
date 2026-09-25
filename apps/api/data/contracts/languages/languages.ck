options {
    keys: {
        area: languages
    }
    services: {
        ConsoleLanguagesService: "#src/modules/languages/console.languages.service.js"
    }
    security: {
        # The floor is the write end: importing or removing a language changes what every operator's
        # console can show, which is an admin's to decide, and a route added without a block of its
        # own inherits that rather than the open reads below.
        policy: platform.manage
    }
}

# The languages the console can be shown in beyond the English it is built with, each one a language pack an admin imported. Reading them needs no session, because the sign-in page is in the operator's language before anybody has signed in

operation /console/languages: {
    get: { # Every language this station holds a pack for, without the strings
        name: List console languages
        service: ConsoleLanguagesService.list
        # Public: the sign-in page reads this before anybody has signed in, and what it lists is
        # interface text, not anything about the station.
        security: none
        response: {
            200: {
                application/json: ConsoleLanguageList
            }
        }
    }
}

operation /console/languages/{locale}: {
    params: {
        locale: string(min=2, max=35)
    }
    get: { # One language's pack, strings and all, as it was imported
        name: Get console language
        service: ConsoleLanguagesService.get
        # Public, for the list's reason: the console loads the pack before the sign-in page draws.
        security: none
        response: {
            200: {
                application/json: ConsoleLanguagePack
            }
        }
    }
    put: { # Installs a language pack, replacing any pack already installed for the language. The tag in the path must be the pack's own
        name: Import console language
        service: ConsoleLanguagesService.import
        request: {
            application/json: ConsoleLanguagePack
        }
        response: {
            200: {
                application/json: ConsoleLanguageList
            }
        }
    }
    delete: { # Removes a language. Anybody who had chosen it sees English
        name: Remove console language
        service: ConsoleLanguagesService.remove
        response: {
            200: {
                application/json: ConsoleLanguageList
            }
        }
    }
}
