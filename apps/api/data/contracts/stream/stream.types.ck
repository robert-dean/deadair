options {
    keys: {
        area: stream
    }
}

# What the station's track fetcher holds by way of a Spotify login
contract FetcherAuthorization: {
    reachable: boolean # Whether the fetcher answered at all. False makes every field below a default rather than a reading, so a fetcher that is merely down is never reported as one that was never authorized
    configured: boolean # Whether this install has a stream half yet. False means there is nothing here to authorize
    authorized: boolean # Whether the fetcher holds its OWN stored authorization, which is the only kind Spotify's login accepts. False with a healthy plugin above it is a station that lists playlists perfectly and cannot fetch a single record
    session: boolean # Whether a login is established right now
    loginError?: string(max=500) # The last reason a login was refused. Present is not the same as fatal: a session may have recovered since
    pendingUrl?: string(max=2000) # An authorization already started and not yet finished, so an operator who lost the URL is given it back rather than having to start again
    callbackUrl?: string(max=2000) # The address the browser will be sent to and will not be able to load. Reported so the console can say which page is expected to fail, rather than leaving that looking like a fault. Absent when the fetcher did not answer, since it is the only thing that knows it
}

# An authorization to open in a browser
contract FetcherAuthorizationStart: {
    authorizeUrl: string(min=1, max=2000) # The Spotify consent page, to be opened by the operator
    expiresInMs: int(min=0) # How long this URL is good for. Starting another replaces it
}

# The callback the browser could not deliver, handed over by the operator instead
contract FetcherAuthorizationInput: {
    redirectUrl: string(min=1, max=2000) # The address the browser ended up at, pasted whole. Taken apart by the fetcher rather than here, because two readings of one address is one of them being wrong eventually
}

# Which account the station now fetches as
contract FetcherAuthorizationFinished: {
    username: string(min=1, max=200) # The Spotify account that was authorized. Reported because an operator with two accounts in two browser profiles wants to know which one this station now is
}
