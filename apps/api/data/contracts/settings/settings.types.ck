options {
    keys: {
        area: settings
    }
}

contract MusicProviderKey: enum(spotify, navidrome)

contract SpotifyMusicProvider: {
    key: literal("spotify")
    name: literal("Spotify")    
    redirectUri: url # The exact OAuth redirect URI that's registered in the Spotify app
    clientId: string(min=1, max=256) # The client ID of the Spotify app
}

contract NavidromeMusicProvider: {
    key: literal("navidrome")
    name: literal("Navidrome")    
    url: url # The URL of the Navidrome instance
    username: string(min=1, max=200) # The username of the Navidrome instance
    password: writeonly string(min=1, max=400) # The password of the Navidrome instance
}

contract MusicProvider: discriminated(by=key, SpotifyMusicProvider | NavidromeMusicProvider)