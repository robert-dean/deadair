options {
    keys: {
        area: users
    }
}

contract UserQuery: PaginationWithActive & { # Which people to list
    search?: string(min=1, max=200) # Part of an email address
    role?: PlatformRole # Only people holding this role
}

contract UserSummary: { # A person with an account on the station
    id: uuid # The person's account id
    email?: string(max=320) # The address they sign in with. Absent for an account that has none, such as one made through a provider that shared no address
    role?: PlatformRole # The one role they hold. Absent for an account nobody has granted one
    active: boolean # False once the account has been switched off. A switched-off person cannot sign in, and every session they held has ended
    createdAt: datetime # When the account was made
    lastSignInAt?: datetime # When they last signed in. Absent if they never have
    hasStrongFactor: boolean # Whether they have an authenticator app or a passkey, which the phone apps need to sign in with
}

contract UserPage: { # One page of people
    meta: Pagination
    data: array(UserSummary)
}

contract UserFactor: { # One way a person signs in. Never the secret itself
    method: enum(email, password, authenticator, fido, oidc, phone) # What kind of factor it is
    methodId: string(max=255) # Which factor of that kind
    kind: enum(knowledge, possession, biometric) # What it proves
    label?: string(max=255) # How it is shown, such as a masked address or the authenticator's name
}

contract UserSignIn: { # One time a person signed in
    occurredAt: datetime # When
    method: string(max=64) # The factor they signed in with
    mfaSatisfied: boolean # Whether a second factor was proved
    ip?: string(max=64) # The address the request came from
    userAgent?: string(max=512) # The app or browser that asked
}

contract UserDetail: UserSummary & { # A person, with how they sign in and where they are signed in
    factors: array(UserFactor) # Every way they can sign in
    sessions: array(Session) # Where they are signed in now
    signIns: array(UserSignIn) # Their most recent sign-ins, newest first
}
