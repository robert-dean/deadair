options {
    keys: {
        area: users
    }
    services: {
        UsersService: "#src/modules/users/users.service.js"
    }
    security: {
        # The floor: an operator. Who has an account, how they sign in and where they are signed in
        # is the station's business, not something a listener's `platform.view` should read.
        policy: platform.manage
    }
}

operation /users: {
    get: { # The station's people, one page at a time, ordered by when their account was made
        name: List users
        mcp: exclude
        service: UsersService.list
        query: UserQuery
        response: {
            200: {
                application/json: UserPage
            }
        }
    }
}

operation /users/{id}: {
    params: {
        id: uuid
    }
    get: { # One person, with every way they sign in, where they are signed in and their recent sign-ins
        name: Get user
        mcp: exclude
        service: UsersService.get
        response: {
            200: {
                application/json: UserDetail
            }
        }
    }
}

# Every write below changes who can do what on the station, so each asks for a recent strong factor
# (`StrongFactorGate`, the step-up the console already answers) on top of the admin floor, and none
# is offered to a connected app through MCP. A person can never change their own role or switch
# themselves off, and the last admin can never be moved off the role or switched off.

operation /users/{id}/role: {
    params: {
        id: uuid
    }
    put: { # Give a person a different role. They hold exactly one, so the role they had is taken away. Refused for your own account, and for the last admin
        name: Change user role
        mcp: exclude
        service: UsersService.changeRole
        request: {
            application/json: UserRoleChange
        }
        response: {
            200: {
                application/json: UserSummary
            }
        }
    }
}

operation /users/{id}/deactivate: {
    params: {
        id: uuid
    }
    post: { # Switch a person off. They are signed out everywhere and cannot sign in, and their API keys, connected apps and chat links stop working, until they are switched back on. Nothing is deleted. Refused for your own account, and for the last admin
        name: Deactivate user
        mcp: exclude
        service: UsersService.deactivate
        response: {
            200: {
                application/json: UserSummary
            }
        }
    }
}

operation /users/{id}/reactivate: {
    params: {
        id: uuid
    }
    post: { # Switch a person back on. They sign in as they did before, and their API keys, connected apps and chat links work again
        name: Reactivate user
        mcp: exclude
        service: UsersService.reactivate
        response: {
            200: {
                application/json: UserSummary
            }
        }
    }
}

operation /users/{id}/sign-out: {
    params: {
        id: uuid
    }
    post: { # Sign a person out everywhere. They can sign straight back in
        name: Sign out user
        mcp: exclude
        service: UsersService.signOut
        response: {
            204:
        }
    }
}

operation /users/{id}/mfa/reset: {
    params: {
        id: uuid
    }
    post: { # Remove a person's authenticator apps and passkeys and sign them out everywhere, for when they have lost the device. They sign in with their password and set a new one up
        name: Reset user MFA
        mcp: exclude
        service: UsersService.resetMfa
        response: {
            204:
        }
    }
}
