options {
    keys: {
        area: vendors
    }
    services: {
        VendorsService: "#src/modules/vendors/vendors.service.js"
    }
}

operation /vendors/spotify/test: {
    get: {
        name: Spotify test
        service: VendorsService.spotifyTest        
        security: none
        response: {
            200: 
        }
    }
}

operation /vendors/spotify/callback: {
    get: {
        name: Spotify callback
        service: VendorsService.spotifyCallback
        query: SpotifyCallbackQuery
        security: none
        response: {
            200: 
        }
    }
}