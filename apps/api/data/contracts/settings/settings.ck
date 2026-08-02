options {
    keys: {
        area: settings
    }
    services: {
        SettingsService: "#src/modules/settings/settings.service.js"
    }
}

operation /settings/music/providers: {
    get: { # Retrieves the list of supported music providers
        name: Get Music Providers
        service: SettingsService.getMusicProviders
        response: {
            200: {
                application/json: array(MusicProvider)
            }
        }
    }   
}

operation /settings/music/providers/{key}: {
    params: {
        key: MusicProviderKey
    }
    put: { 
        name: Update music provider 
        service: SettingsService.updateMusicProvider
        request: {
            application/json: MusicProvider
        }
        response: {
            200: {
                application/json: MusicProvider
            }
        }
    }
}