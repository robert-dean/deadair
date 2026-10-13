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

contract InvitationToken: { # An invitation's link token, as it appears after `#` on the invite page
    token: string(min=1, max=200) # The token
}

contract InvitationDetails: { # What an open invitation is for, shown to the person before they accept
    email: string(max=320) # The address the account will have
    role: PlatformRole # The role it will hold
    stationName: string # What the station calls itself
    expiresAt: datetime # When the link stops working
}

contract InvitationSecondStep: enum(authenticator, fido) # How the person will prove it is them after their password: an authenticator app, or a passkey

contract InvitationAcceptStart: { # Choose a password and a second step. Nothing is saved yet
    token: string(min=1, max=200) # The invitation's token
    password: string(min=8, max=256) # The password the account will have. Refused here if it is too weak, so the person learns before setting anything else up
    method: InvitationSecondStep # The second step to set up
}

contract InvitationAuthenticatorSetup: { # An authenticator app to scan, for an invitation being accepted
    method: literal("authenticator") # Discriminator
    registrationId: string # Send this back with the first code
    secret: string # The key, for an app that cannot scan
    uri: string # The `otpauth://` address the QR code holds
    qrCode: string # The QR code, as a data URL
}

contract InvitationPasskeySetup: { # A passkey to make, for an invitation being accepted
    method: literal("fido") # Discriminator
    registrationId: string # Send this back with the credential
    attestation: FidoFactorAttestation # What to hand `navigator.credentials.create`
}

contract InvitationAcceptStartResponse: discriminated(by=method, InvitationAuthenticatorSetup | InvitationPasskeySetup)

contract InvitationAcceptWithAuthenticator: { # Accept with the first code from the authenticator app
    method: literal("authenticator") # Discriminator
    token: string(min=1, max=200) # The invitation's token
    password: string(min=8, max=256) # The same password as at the start
    registrationId: string # From the start
    code: string(min=6, max=10) # The first code the app shows
}

contract InvitationAcceptWithPasskey: { # Accept with the passkey the browser just made
    method: literal("fido") # Discriminator
    token: string(min=1, max=200) # The invitation's token
    password: string(min=8, max=256) # The same password as at the start
    registrationId: string # From the start
    credential: PublicKeyCredentialWithAttestation # What `navigator.credentials.create` answered
}

contract InvitationAccept: discriminated(by=method, InvitationAcceptWithAuthenticator | InvitationAcceptWithPasskey)

contract InvitationAccepted: { # The account made from an invitation. Sign in with it as usual
    email: string(max=320) # The address to sign in with
    role: PlatformRole # The role it holds
}
