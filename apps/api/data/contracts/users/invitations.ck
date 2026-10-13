options {
    keys: {
        area: users
        subarea: invitations
    }
    services: {
        InvitationsService: "#src/modules/users/invitations.service.js"
    }
    security: {
        # The floor: an operator. An invitation is an account waiting to be claimed, so making one,
        # seeing its link and withdrawing it are all the station's decision. Accepting one is the
        # invite page's business and lives in its own file, where the token is the credential.
        policy: platform.manage
    }
}

operation /invitations: {
    get: { # Every invitation, newest first, with the link of each one still open
        name: List invitations
        mcp: exclude
        service: InvitationsService.list
        response: {
            200: {
                application/json: InvitationList
            }
        }
    }
    post: { # Invite somebody into a role. An open invitation to the same address is withdrawn first, so this is also how one is sent again. Refused for an address that already has an account
        name: Create invitation
        mcp: exclude
        service: InvitationsService.create
        request: {
            application/json: InvitationCreate
        }
        response: {
            201: {
                application/json: Invitation
            }
        }
    }
}

operation /invitations/{id}: {
    params: {
        id: uuid
    }
    delete: { # Withdraw an invitation. Its link stops working at once. Nothing is deleted: it stays in the list as withdrawn
        name: Revoke invitation
        mcp: exclude
        service: InvitationsService.revoke
        response: {
            200: {
                application/json: Invitation
            }
        }
    }
}
