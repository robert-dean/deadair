options {
    keys: {
        area: users
    }
}

contract InvitationState: enum(pending, accepted, revoked, expired) # Where an invitation stands. `expired` is a pending invitation whose time ran out

contract Invitation: { # An invitation for somebody to take an account on the station
    id: uuid # The invitation's id
    email: string(max=320) # The address the account will have. The person cannot change it while accepting
    role: PlatformRole # The role the account will hold
    state: InvitationState # Where it stands
    createdAt: datetime # When it was made
    expiresAt: datetime # When the link stops working, if nobody has used it
    invitedBy?: string(max=320) # The address of the admin who made it. Absent once their account is gone
    acceptedAt?: datetime # When somebody accepted it
    revokedAt?: datetime # When it was withdrawn, by an admin or by a newer invitation to the same address
    token?: string(max=200) # The invitation itself, only while it is pending. Put it after `#` on the station's `/invite` page, as `/invite#<token>`. Anyone holding it can claim the account, so show it only to the person invited
}

contract InvitationList: { # The station's invitations, newest first
    data: array(Invitation)
}

contract InvitationCreate: { # Invite somebody by their address
    email: email # The address the account will have
    role: PlatformRole # The role the account will hold
}
