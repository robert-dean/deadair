options {
    keys: {
        area: authentication
    }
}

contract PhoneFactorRegistration: {
    method: literal("phone") # The method of the factor
    value: string(regex=/^\+[1-9]\d{1,14}$/) # The phone number in E.164 format (e.g. `+12025550123`)
    codeChallenge: string(max=100) # A base64url encoded SHA256 hash of a one time secret used to validate that the request starts and ends on the same device
}

contract PasswordFactorRegistration: {
    method: literal("password") # The method of the factor
    value: string(min=8, max=256) # The password
}

contract EmailFactorRegistration: {
    method: literal("email") # The method of the factor
    value: email # The email address
    codeChallenge: string(max=100) # A base64url encoded SHA256 hash of a one time secret used to validate that the request starts and ends on the same device
}

contract AuthenticatorFactorRegistration: {
    method: literal("authenticator") # The method of the factor
    codeChallenge: string(max=100) # A base64url encoded SHA256 hash of a one time secret used to validate that the request starts and ends on the same device
    label?: string # The label for the authenticator factor
}

contract FidoFactorRegistration: {
    method: literal("fido") # The method of the factor
    label?: string # The label for the FIDO factor
}

contract AuthenticationFactorRegistration: discriminated(by=method, PhoneFactorRegistration | PasswordFactorRegistration | EmailFactorRegistration | AuthenticatorFactorRegistration | FidoFactorRegistration)

contract PhoneFactorRegistrationResponse: {
    method: literal("phone") # The method of the factor
    registrationId: string # The registration identifier
    expiresAt: datetime # The expiration timestamp
    issuedAt: datetime # The issuance timestamp
}

contract PasswordFactorRegistrationResponse: {
    method: literal("password") # The method of the factor
    needsReset: boolean # Whether the password needs to be reset
}

contract EmailFactorRegistrationResponse: {
    method: literal("email") # The method of the factor
    registrationId: string # The registration identifier
    expiresAt: datetime # The expiration timestamp
    issuedAt: datetime # The issuance timestamp
}

contract AuthenticatorFactorRegistrationResponse: {
    method: literal("authenticator") # The method of the factor
    registrationId: string # The registration identifier
    secret: string # The secret for the authenticator
    uri: string # The URI for the authenticator
    qrCode: string # The QR code for the authenticator
    expiresAt: datetime # The expiration timestamp
    issuedAt: datetime # The issuance timestamp
}

contract FidoFactorAttestation: { # The FIDO factor attestation information
    rp: { # The relying party
        name: string # The relying party name
        id: string # The relying party identifier
        icon?: string # The relying party icon
    }
    user: {
        id: string # The user identifier
        name: string # The user name
        displayName: string # The user display name
    }
    challenge: string # The challenge
    pubKeyCredParams: array({ type: literal("public-key"), alg: int }) # The public key credential parameters
    timeout?: int # The timeout
    attestation: enum(direct, indirect, none) # The attestation
}

contract FidoFactorRegistrationResponse: {
    method: literal("fido") # The method of the factor
    registrationId: string # The registration identifier
    expiresAt: datetime # The expiration timestamp
    issuedAt: datetime # The issuance timestamp
    attestation: FidoFactorAttestation # The FIDO factor attestation information
}

contract AuthenticationFactorRegistrationResponse: discriminated(by=method, PhoneFactorRegistrationResponse | PasswordFactorRegistrationResponse | EmailFactorRegistrationResponse | AuthenticatorFactorRegistrationResponse | FidoFactorRegistrationResponse)

contract PhoneFactorRegistrationVerification: {
    method: literal("phone") # The method of the factor
    registrationId: string # The registration identifier
    code: string(min=6, max=10) # The verification code
    codeVerifier: string(min=43, max=128) # A base64url encoded one time secret used to validate that the request starts and ends on the same device
}

contract EmailFactorRegistrationVerification: {
    method: literal("email") # The method of the factor
    registrationId: string # The registration identifier
    code: string(min=6, max=10) # The verification code
    codeVerifier: string(min=43, max=128) # A base64url encoded one time secret used to validate that the request starts and ends on the same device
}

contract AuthenticatorFactorRegistrationVerification: {
    method: literal("authenticator") # The method of the factor
    registrationId: string # The registration identifier
    code: string(min=6, max=10) # The verification code
    codeVerifier: string(min=43, max=128) # A base64url encoded one time secret used to validate that the request starts and ends on the same device
}

contract FidoFactorRegistrationVerification: {
    method: literal("fido") # The method of the factor
    registrationId: string # The registration identifier
    credential: PublicKeyCredentialWithAttestation # The credential the client posts back to complete registration
}

contract AuthenticationFactorRegistrationVerification: discriminated(by=method, PhoneFactorRegistrationVerification | EmailFactorRegistrationVerification | AuthenticatorFactorRegistrationVerification | FidoFactorRegistrationVerification)

contract MfaEnrollAuthenticatorStart: { # Begin enrolling a TOTP authenticator during a pending login MFA challenge (no session — authorized by the challenge)
    mfa_challenge_id: string(max=100) # The pending MFA challenge from the `mfa_required` login response
    label?: string(max=100) # Optional label for the new authenticator factor
}

contract MfaEnrollAuthenticatorVerify: { # Verify the first TOTP code, persist the authenticator, and complete login
    mfa_challenge_id: string(max=100) # The same pending MFA challenge
    registrationId: string # The registration id returned by the enroll-start response
    code: string(min=6, max=10) # The first TOTP code from the user's authenticator app
}

contract EnrollmentMethod: enum(authenticator, phone, fido) # A second-factor method a user may enroll

contract EnrollmentMethods: { # Which second factors this instance permits enrolling. `phone` is present only when an SMS provider is configured (SMS_DELIVERY != noop); `authenticator` and `fido` are always available.
    methods: array(EnrollmentMethod) # The enrollable factor methods, in suggested display order
}

contract MfaEnrollPhoneStart: { # Begin enrolling an SMS phone factor during a pending login MFA challenge (no session — authorized by the challenge)
    mfa_challenge_id: string(max=100) # The pending MFA challenge from the `mfa_required` login response
    value: string(regex=/^\+[1-9]\d{1,14}$/) # The phone number in E.164 format (e.g. `+12025550123`)
}

contract MfaEnrollPhoneStartResponse: { # Acknowledges the phone registration and that an OTP was texted
    method: literal("phone") # The method of the factor
    registrationId: string # The registration id — echo back on the verify call
    expiresAt: datetime # When the registration expires
    issuedAt: datetime # When the registration was issued
}

contract MfaEnrollPhoneVerify: { # Verify the texted OTP, persist the phone factor, and complete login
    mfa_challenge_id: string(max=100) # The same pending MFA challenge
    registrationId: string # The registration id returned by the enroll-start response
    code: string(min=6, max=10) # The one-time code texted to the phone
}

contract MfaEnrollFidoStart: { # Begin enrolling a passkey during a pending login MFA challenge (no session — authorized by the challenge)
    mfa_challenge_id: string(max=100) # The pending MFA challenge from the `mfa_required` login response
    label?: string(max=100) # Optional label for the new passkey factor
}

contract MfaEnrollFidoStartResponse: { # WebAuthn attestation options for `navigator.credentials.create`
    method: literal("fido") # The method of the factor
    registrationId: string # The registration id — echo back on the verify call
    expiresAt: datetime # When the registration expires
    issuedAt: datetime # When the registration was issued
    attestation: FidoFactorAttestation # The WebAuthn attestation (credential-creation) options
}

contract MfaEnrollFidoVerify: { # Post the new credential back, persist the passkey factor, and complete login
    mfa_challenge_id: string(max=100) # The same pending MFA challenge
    registrationId: string # The registration id returned by the enroll-start response
    credential: PublicKeyCredentialWithAttestation # The credential produced by `navigator.credentials.create`
}
