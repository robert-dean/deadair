options {
    keys: {
        area: authentication
        subarea: apikeys
    }
    services: {
        ApiKeysService: "#src/modules/authentication/api.keys.service.js"
    }
    security: {
        # The floor for every operation here: a signed-in account holding either platform role. An
        # account with no role could do nothing with a key it minted, so it may not mint one. A
        # request made WITH a key passes this gate and is refused by the service, because
        # `requireAuthentication` refuses keys: a key must never mint, rotate or revoke keys.
        policy: platform.view
    }
}

operation /auth/apikeys: {
    get: { # The signed-in account's API keys, newest first, including revoked and expired ones so the list says what was withdrawn and when
        name: List API keys
        service: ApiKeysService.list
        response: {
            200: {
                application/json: ApiKeyList
            }
        }
    }
    post: { # Issue a new API key for the signed-in account. The token is in this response and nowhere else, ever. Once the account has a strong second factor, this needs one verified in the last five minutes
        name: Create API key
        service: ApiKeysService.create
        request: {
            application/json: ApiKeyCreate
        }
        response: {
            201: {
                application/json: ApiKeyIssued
            }
        }
    }
}

operation /auth/apikeys/{id}/rotate: {
    params: {
        id: uuid
    }
    post: { # Give a key a new token, so the old one stops working at once. The key keeps its name, scopes and expiry. Needs the same recent second factor as creating one
        name: Rotate API key
        service: ApiKeysService.rotate
        response: {
            200: {
                application/json: ApiKeyIssued
            }
        }
    }
}

operation /auth/apikeys/{id}: {
    params: {
        id: uuid
    }
    delete: { # Revoke a key. Every request made with it is refused from the next one on. The key stays in the list, marked revoked
        name: Revoke API key
        service: ApiKeysService.revoke
        response: {
            204:
        }
    }
}
