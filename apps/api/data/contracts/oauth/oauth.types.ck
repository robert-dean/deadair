options {
    keys: {
        area: oauth
    }
}

contract OAuthAuthorizationQuery: { # An app's authorization request, as the consent page received it
    query: string(max=8192) # The query string the app sent the browser to the consent page with, as `window.location.search` holds it
}

contract OAuthClientKind: enum(preregistered, dynamic, metadata_document) # How the station knows an app: registered by an operator, registered by itself, or described by a document on its own website

contract OAuthAuthorizationContext: { # A valid request, stashed for the signed-in person to approve or deny
    kind: literal("context") # Discriminator
    requestId: string(max=200) # What approving or denying names. Good for a few minutes, and only for the person it was shown to
    clientId: string # The app's client id
    clientKind: OAuthClientKind # How the station knows the app
    clientName?: string # What the app calls itself
    clientUri?: string # The app's own website, when it gave one
    logoUri?: string # The app's logo, when it gave one
    redirectHost: string # The host the browser is sent back to, which is who actually receives the approval
    loopbackOnly: boolean # Whether every address the app registered is this computer's own, which only an app running on it should use
    scope: array(string) # What the app asked for. It acts as the person approving it whatever this says
    resource: string # What the app will be able to reach: the station's MCP endpoint
}

contract OAuthAuthorizationRedirect: { # A request with something wrong that the app should be told about: send the browser back to it
    kind: literal("redirect") # Discriminator
    redirectUrl: string # Where to send the browser
}

contract OAuthAuthorizationRefusal: { # A request that names no app the station knows, or an address the app did not register. Never sent anywhere
    kind: literal("refuse") # Discriminator
    error: string # The OAuth error code
    description: string # What was wrong, in words
}

contract OAuthAuthorizationContextResult: discriminated(by=kind, OAuthAuthorizationContext | OAuthAuthorizationRedirect | OAuthAuthorizationRefusal)

contract OAuthAuthorizationDecision: { # Approving or denying a stashed request
    requestId: string(max=200) # From the context
}

contract OAuthAuthorizationOutcome: { # Where to send the browser now
    redirectUrl: string # The app's own address, carrying the code or the refusal
}

contract OAuthClientAuthMethod: enum(none, client_secret_post, client_secret_basic) # How the app proves itself at the token endpoint. `none` is a public client, which is what apps on somebody's own device are

contract OAuthClientSummary: { # An app registered with the station
    clientId: string # Its client id
    kind: enum(preregistered, dynamic) # Created by an operator, or registered by itself
    name?: string # What it is called
    redirectUris: array(string) # Where it may be sent back to
    tokenEndpointAuthMethod: OAuthClientAuthMethod # How it proves itself
    createdAt: datetime # When it was registered
    lastUsedAt?: datetime # When it last obtained a token
    expiresAt?: datetime # When a self-registered app lapses unless used again
}

contract OAuthClientList: {
    clients: array(OAuthClientSummary) # Newest first. Apps that describe themselves are not listed: nothing is stored for them
}

contract OAuthClientCreate: { # An app an operator registers by hand, for a client that cannot register itself
    name: string(min=1, max=100) # What to call it
    redirectUris: array(string(max=2048)) # Where it may be sent back to. At least one; https, or this computer's own address
    tokenEndpointAuthMethod: OAuthClientAuthMethod # `none` for an app on somebody's own device, otherwise a secret it keeps
}

contract OAuthClientIssued: { # A registered app, with its secret. The only time the secret is ever returned
    client: OAuthClientSummary # The app as it will appear in the list
    clientSecret?: string # Present for an app that keeps a secret. Store it now: nothing can show it again
}

contract OAuthGrant: { # An app the signed-in person has let act as them
    id: uuid # For disconnecting it
    clientId: string # The app's client id
    clientName?: string # What the app calls itself, when the station can still find out
    resource: string # What it can reach
    scope: array(string) # What it asked for
    createdAt: datetime # When it was first approved
    lastUsedAt?: datetime # When it last obtained a token
}

contract OAuthGrantList: {
    grants: array(OAuthGrant) # Most recent first
}
