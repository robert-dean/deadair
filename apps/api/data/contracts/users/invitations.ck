options {
    keys: {
        area: users
        subarea: invitations
    }
    services: {
        InvitationsService: "#src/modules/users/invitations.service.js"
        InvitationAcceptService: "#src/modules/users/invitation.accept.service.js"
    }
    security: {
        # The floor: an operator. An invitation is an account waiting to be claimed, so making one,
        # seeing its link and withdrawing it are all the station's decision. The three accept
        # operations at the foot of the file override it with `none`, for the reason given there.
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

# Accepting an invitation happens on the invite page, by somebody with no account yet, so these three
# are public: the token in each body is the credential, on the party pass's argument. None of them is
# ever a GET and none of them is called on page load, so a mail scanner or a link preview fetching
# the link spends nothing. Only the last changes anything, and it needs the password the person chose
# and a working second step, so the account, its factors and its role are made together or not at
# all. All three are limited per address, and a dead invitation (unknown, used, withdrawn or out of
# time) is one 404 that does not say which.

operation /invitations/accept/details: {
    post: { # What an open invitation is for: the address, the role and the station. Changes nothing
        name: Read invitation
        mcp: exclude
        service: InvitationAcceptService.details
        security: none
        request: {
            application/json: InvitationToken
        }
        response: {
            200: {
                application/json: InvitationDetails
            }
        }
    }
}

operation /invitations/accept/start: {
    post: { # Check the password and start setting up the second step. Nothing is saved, and starting again replaces the setup
        name: Start accepting invitation
        mcp: exclude
        service: InvitationAcceptService.start
        security: none
        request: {
            application/json: InvitationAcceptStart
        }
        response: {
            200: {
                application/json: InvitationAcceptStartResponse
            }
        }
    }
}

operation /invitations/accept: {
    post: { # Accept: make the account with its password, its second step and its role, all at once, and spend the invitation
        name: Accept invitation
        mcp: exclude
        service: InvitationAcceptService.accept
        security: none
        request: {
            application/json: InvitationAccept
        }
        response: {
            201: {
                application/json: InvitationAccepted
            }
        }
    }
}
