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
