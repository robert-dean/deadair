options {
    keys: {
        area: authentication
    }
}

contract AuthenticationGrantType: enum(
    client_credentials,
    password,
    refresh_token,
    link,
    code,
    fido,
    authenticator,
    oidc
) # Denotes the authorization flow to use

contract PasswordlessAuthenticationGrantType: enum(link, code, fido, oidc) # Denotes the authorization flow to use

contract AuthenticationFactorMethod: enum(phone, password, email, authenticator, fido, oidc) # The type of the factor

contract AuthenticationFactorKind: enum(knowledge, possession, biometric) # The kind of the factor

contract OidcProvider: enum(google) # The OIDC identity provider

contract BaseAuthenticationRequest: {
    grant_type: AuthenticationGrantType # The grant type for the request
    scope?: string(max=100) # The scope of the request
    client_id?: uuid # The application's client identifier, if available
}

contract ClientCredentialsAuthenticationRequest: BaseAuthenticationRequest & { # Represents an application authentication request
    grant_type: literal("client_credentials") # The grant type for the request
    client_id: uuid # The client identifier
    client_secret: string(min=8, max=256) # The client secret
}

contract PasswordAuthenticationRequest: BaseAuthenticationRequest & { # Represents an authentication password request
    grant_type: literal("password") # The grant type for the request
    username: string(min=3, max=64) # User's identifier, usually an email address
    password: string(min=8, max=256) # User's password
}

contract RefreshTokenAuthenticationRequest: BaseAuthenticationRequest & { # Represents an authentication refresh request
    grant_type: literal("refresh_token") # The grant type for the request
    refresh_token?: string # The refresh token issued by the authorization server. Optional: browser clients omit it and present the httpOnly refresh cookie instead
}

contract LinkAuthenticationRequest: BaseAuthenticationRequest & { # Represents an authentication magic link request
    grant_type: literal("link") # The grant type for the request
    challenge_id: string(max=100) # The email challenge id returned by `POST /auth/login/start` — binds the link to the issued challenge so cross-device clicks work
    link: string # The magic link token
}

contract CodeAuthenticationRequest: BaseAuthenticationRequest & { # Represents an authentication one-time-code request
    grant_type: literal("code") # The grant type for the request
    code: string(min=6, max=10) # The one-time code
    code_verifier?: string(min=43, max=128) # PKCE verifier — required for a primary code login; absent when mfa_challenge_id is set
    mfa_challenge_id?: string(max=100) # When set, completes a pending MFA challenge; replaces code_verifier as proof-of-origin
    challenge_id?: string(max=100) # The phone/email challenge id (returned by POST /auth/factors/start for phone-MFA). Required when mfa_challenge_id is set; ignored otherwise (resolved via PKCE)
}

contract FidoAuthenticationRequest: BaseAuthenticationRequest & { # Represents an authentication passkey request
    grant_type: literal("fido") # The grant type for the request
    credential: PublicKeyCredentialWithAssertion # A passkey credential object
    challenge_id: string(max=100) # The FIDO assertion challenge id returned by `POST /auth/login/start` (primary) or `POST /auth/factors/start` (MFA second factor). Must be the per-challenge id, not the actor id.
    mfa_challenge_id?: string(max=100) # When set, completes a pending MFA challenge instead of issuing a single-factor session
}

contract AuthenticatorAuthenticationRequest: BaseAuthenticationRequest & { # Submit a TOTP code as a second factor against a pending MFA challenge
    grant_type: literal("authenticator") # The grant type for the request
    code: string(min=6, max=10) # The TOTP code
    mfa_challenge_id: string(max=100) # The pending MFA challenge — required, TOTP has no other actor binding at initial login
    method_id: string # The id of the enrolled authenticator factor to verify against (must be present in the MFA challenge's eligible list)
}

contract OidcAuthenticationRequest: BaseAuthenticationRequest & { # Redeem a completed OIDC authorization that the callback stashed under a one-time id
    grant_type: literal("oidc") # The grant type for the request
    challenge_id: string(max=100) # The one-time stash id from the OIDC callback redirect (the value after `?token=oidc:` on `/auth/callback`). Single-use — the API consumes it via `OidcFactorService.redeemAuthenticatedExchange`.
}

contract AuthenticationRequest: discriminated(by=grant_type, PasswordAuthenticationRequest | ClientCredentialsAuthenticationRequest | RefreshTokenAuthenticationRequest | LinkAuthenticationRequest | CodeAuthenticationRequest | FidoAuthenticationRequest | AuthenticatorAuthenticationRequest | OidcAuthenticationRequest)

contract format(output=snake) AuthenticationToken: { # Represents an authentication token
    accessToken: string # The access token string as issued by the authorization server
    refreshToken?: string # A refresh token which applications can use to obtain another access token
    expiresIn: int # Unix timestamp (seconds) when the access token expires
    tokenType: string # The type of token this is, typically just the string *Bearer*
    scope: string # Space-separated list of scopes granted to this token
}

contract format(output=snake) AuthenticationTokenIssued: { # Issued-token arm of /auth/token response
    result: literal("token") # Discriminator
    accessToken: string # The access token string as issued by the authorization server
    refreshToken?: string # A refresh token which applications can use to obtain another access token
    expiresIn: int # Unix timestamp (seconds) when the access token expires
    tokenType: string # The type of token this is, typically just the string *Bearer*
    scope: string # Space-separated list of scopes granted to this token
}

contract format(output=snake) MfaChallengeFactor: { # A factor the SPA may use to satisfy the MFA challenge
    method: AuthenticationFactorMethod # The factor method
    methodId: string # The id of the enrolled factor (opaque to the SPA, must be echoed back in the proof for methods that don't bind another way)
    kind: AuthenticationFactorKind # The factor kind (knowledge, possession, biometric) — the SPA filters against step-up `acceptableKinds`/`excludeKinds` hints
    label?: string # Optional human-readable label (e.g. provider name for OIDC, friendly name for FIDO)
}

contract format(output=snake) MfaRequiredResponse: { # MFA-required arm of /auth/token response
    result: literal("mfa_required") # Discriminator
    challengeId: string(max=100) # The MFA challenge identifier — pass back as `mfa_challenge_id` on the proof grant
    expiresAt: datetime # When the MFA challenge expires
    factors: array(MfaChallengeFactor) # Eligible factors the SPA may use to complete the challenge
}

contract format(output=snake) EnrollmentRequiredResponse: { # Returned by /auth/step-up/start when no enrolled factor satisfies the requirement. The SPA should drive the user through enrollment and retry the gated action afterwards.
    result: literal("enrollment_required") # Discriminator
}

contract StepUpStartResponse: discriminated(by=result, MfaRequiredResponse | EnrollmentRequiredResponse)

contract AuthenticationTokenResponse: discriminated(by=result, AuthenticationTokenIssued | MfaRequiredResponse)

contract PublicKeyCredential: { # Represents a common shape of a `PublicKeyCredential` after the client serializes the `id` and `rawId` fields to base64 strings for transport
    id: string # The base64url encoding of `rawId`
    type: literal("public-key") # This enumeration defines the valid credential types. It is an extension point; values can be added to it in the future, as more credential types are defined. The values of this enumeration are used for versioning the Authentication Assertion and attestation structures according to the type of the authenticator. Currently one credential type is defined, namely `public-key`.
    rawId: string # The credential identifier
    authenticatorAttachment?: enum(cross-platform, platform) # The authenticator attachment
}

contract SimpleClientExtensionResults: { # Subset of the WebAuthn client extension results the service round-trips
    appid?: boolean # Whether the client is an application
    appidExclude?: boolean # Whether the client is excluded from appid verification
    credProps?: {
        rk: boolean # Whether the client supports the rk extension
    }
}

contract FidoAuthenticatorAssertionResponse: {
    clientDataJSON: string # The client data JSON
    authenticatorData: string # The authenticator data
    signature: string # The signature
    userHandle?: string # The user handle
}

contract PublicKeyCredentialWithAssertion: PublicKeyCredential & {
    clientExtensionResults: SimpleClientExtensionResults # The client extension results
    response: FidoAuthenticatorAssertionResponse # The authenticator assertion response
}

contract AuthenticationRegistration: {
    registrationId: readonly string # The registration identifier
    expiresAt: readonly datetime # The registration expiration timestamp
    email: writeonly email # User's email address
    password?: writeonly string(min=8, max=256) # optionally set a password for the user
}

contract AuthenticationRegistrationVerification: {
    registrationId: string # The registration identifier
    code: string(min=6, max=10) # The verification code
}

contract BaseAuthenticationLoginStart: {
    grant_type: PasswordlessAuthenticationGrantType # The grant type for the request
    client_id?: uuid # The application's client identifier, if available
}

contract BaseAuthenticationLoginStartWithEmail: BaseAuthenticationLoginStart & {
    email: email # User's email address
}

contract LinkAuthenticationLoginStart: BaseAuthenticationLoginStartWithEmail & {
    grant_type: literal("link") # The grant type for the request
}

contract CodeAuthenticationLoginStart: BaseAuthenticationLoginStartWithEmail & {
    grant_type: literal("code") # The grant type for the request
    code_challenge: string(max=100) # A base64url encoded SHA256 hash of a one time secret used to validate that the request starts and ends on the same device
}

contract FidoAuthenticationLoginStart: BaseAuthenticationLoginStartWithEmail & {
    grant_type: literal("fido") # The grant type for the request
}

contract OidcAuthenticationLoginStart: BaseAuthenticationLoginStart & { # Request to begin an OIDC sign-in flow
    grant_type: literal("oidc") # The grant type for the request
    provider: OidcProvider # The IdP to authorize against
}

contract AuthenticationLoginStart: discriminated(by=grant_type, LinkAuthenticationLoginStart | CodeAuthenticationLoginStart | FidoAuthenticationLoginStart | OidcAuthenticationLoginStart)

contract PublicKeyCredentialDescriptor: { # A credential the relying party expects the user to be able to present
    type: literal("public-key") # The credential type — currently always `public-key`
    id: string # The base64url-encoded credential identifier
    transports?: array(enum(usb, nfc, ble, internal, hybrid)) # Transports the authenticator advertises
}

contract BaseAuthenticationLoginStartResponse: {
    grant_type: PasswordlessAuthenticationGrantType # The grant type for the response
    challengeId: string(max=100) # The challenge identifier
    expiresAt: datetime # The challenge expiration timestamp
}

contract CodeAuthenticationLoginStartResponse: BaseAuthenticationLoginStartResponse & {
    grant_type: literal("code") # The grant type for the response
}

contract LinkAuthenticationLoginStartResponse: BaseAuthenticationLoginStartResponse & {
    grant_type: literal("link") # The grant type for the response
}

contract FidoPublicKeyCredentialRequestOptions: {
    challenge: string
    timeout?: int # WebAuthn timeout hint in milliseconds
    rpId?: string
    attestation?: enum(direct, indirect, none) # The attestation
    userVerification?: enum(required, preferred, discouraged) # Whether the authenticator must verify the user
    rawChallenge?: binary # The raw challenge
    extensions?: object
    allowCredentials?: array(PublicKeyCredentialDescriptor)
}

contract FidoAuthenticationLoginStartResponse: BaseAuthenticationLoginStartResponse & { # WebAuthn assertion options for `navigator.credentials.get`
    grant_type: literal("fido") # The grant type for the response
    assertion: FidoPublicKeyCredentialRequestOptions # The WebAuthn assertion options
}

contract OidcAuthenticationLoginStartResponse: BaseAuthenticationLoginStartResponse & { # Response from `/auth/login/oidc/start` instructing the client to navigate to `authorize_url`
    grant_type: literal("oidc") # The grant type for the response
    authorize_url: string # Fully-formed authorize URL the user-agent should be redirected to
    state: string(max=200) # Opaque state token bound to this authorization round-trip
}

contract AuthenticationLoginStartResponse: discriminated(by=grant_type, CodeAuthenticationLoginStartResponse | LinkAuthenticationLoginStartResponse | FidoAuthenticationLoginStartResponse | OidcAuthenticationLoginStartResponse)

contract FidoAuthenticatorTransport: enum(hybrid, ble, internal, nfc, usb) # The transport used by the authenticator

contract FidoAuthenticatorAttestationResponse: { # Serialized form of `AuthenticatorAttestationResponse` — produced by the browser at registration; all binary fields are base64-encoded for transport
    clientDataJSON: string # The client data JSON
    attestationObject: string # The attestation object
    transports?: array(FidoAuthenticatorTransport) # The transports used by the authenticator
}

contract PublicKeyCredentialWithAttestation: PublicKeyCredential & { # The credential the client posts back to complete registration
    clientExtensionResults: SimpleClientExtensionResults # The client extension results
    response: FidoAuthenticatorAttestationResponse # The authenticator attestation response
}

contract AuthenticationFactor: {
    method: AuthenticationFactorMethod # The method of the factor
    kind: AuthenticationFactorKind # The kind of the factor
    methodId: string # The method identifier
    label?: string # The label for the factor
}

contract OidcLoginStart: { # Request to begin an OIDC sign-in flow
    provider: OidcProvider # The IdP to authorize against
    redirect_after?: string(max=2048) # Optional URL the SPA wants the callback to land on after token issuance
}

contract OidcLoginStartResponse: { # Response from `/auth/login/oidc/start` instructing the client to navigate to `authorize_url`
    authorize_url: string # Fully-formed authorize URL the user-agent should be redirected to
    state: string(max=200) # Opaque state token bound to this authorization round-trip
    expires_at: datetime # When the cached state record expires
}

contract OidcLoginCallback: { # Request to complete an OIDC sign-in flow
    iss?: string # The issuer of the token
    scope?: string # The scope of the token
    authuser?: string # The user ID
    hd?: string # The host domain
    prompt?: string # The prompt of the token
    code?: string(max=4096) # The authorization code returned by the IdP (absent when the IdP rejected the request)
    state?: string(max=200) # The opaque state token bound to the original authorize request
    error?: string(max=200) # OAuth 2.0 error code per RFC 6749 §4.1.2.1 (e.g. access_denied)
    error_description?: string(max=2048) # Human-readable explanation of `error`
    error_uri?: string(max=2048) # URL to a page describing `error`
}

contract FactorChallengePhoneStart: { # Issue a phone SMS challenge during a pending MFA round
    method: literal("phone") # Discriminator
    transport: literal("sms") # Delivery channel — only `sms` is supported in this phase
    mfa_challenge_id: string(max=100) # The MFA challenge to which this factor challenge is bound
}

contract FactorChallengeFidoStart: { # Issue a WebAuthn assertion challenge during a pending MFA round
    method: literal("fido") # Discriminator
    mfa_challenge_id: string(max=100) # The MFA challenge to which this factor challenge is bound
}

contract FactorChallengeEmailStart: { # Issue an email OTP challenge during a pending MFA round
    method: literal("email") # Discriminator
    issueMethod?: enum(code, magiclink) # How to deliver the challenge — defaults to `code` (six-digit OTP)
    mfa_challenge_id: string(max=100) # The MFA challenge to which this factor challenge is bound
}

contract FactorChallengeStartRequest: discriminated(by=method, FactorChallengePhoneStart | FactorChallengeFidoStart | FactorChallengeEmailStart)

contract format(output=snake) FactorChallengePhoneStartResponse: { # Response for a phone SMS challenge
    method: literal("phone") # Discriminator
    transport: literal("sms") # Echo of the chosen delivery channel
    phoneChallengeId: string(max=100) # The phone-factor challenge id — echo back on the `code` grant as `challenge_id`
    expiresAt: datetime # When the phone challenge expires
}

contract format(output=snake) FactorChallengeFidoStartResponse: { # Response for a FIDO assertion challenge
    method: literal("fido") # Discriminator
    fidoChallengeId: string(max=100) # The FIDO-factor challenge id — echo back on the `fido` grant as `challenge_id`
    assertion: FidoPublicKeyCredentialRequestOptions # WebAuthn assertion options for navigator.credentials.get
    expiresAt: datetime # When the FIDO challenge expires
}

contract format(output=snake) FactorChallengeEmailStartResponse: { # Response for an email OTP challenge
    method: literal("email") # Discriminator
    issueMethod: enum(code, magiclink) # Echo of the chosen delivery channel
    emailChallengeId: string(max=100) # The email-factor challenge id — echo back on the `code` grant as `challenge_id`
    expiresAt: datetime # When the email challenge expires
}

contract FactorChallengeStartResponse: discriminated(by=method, FactorChallengePhoneStartResponse | FactorChallengeFidoStartResponse | FactorChallengeEmailStartResponse)

contract StepUpStartRequest: { # Mint a fresh MFA challenge for the current session so the SPA can satisfy a `step_up_required` denial. Filters mirror `StepUpRequirement` from `@maroonedsoftware/policies`.
    acceptableMethods?: array(AuthenticationFactorMethod) # If set, only these factor methods are listed as eligible
    acceptableKinds?: array(AuthenticationFactorKind) # If set, only these factor kinds are listed as eligible
    excludeMethods?: array(AuthenticationFactorMethod) # If set, factors with these methods are never listed
}

contract SessionFactor: { # A factor satisfied by the session
    method: enum(phone, password, authenticator, email, fido, oidc) # The verification method
    methodId: string(max=255) # Stable identifier for the specific factor record
    kind: enum(knowledge, possession, biometric) # MFA category for the factor
    issuedAt: readonly datetime # When this factor entry was first added to the session
    authenticatedAt: readonly datetime # When the factor was most recently re-verified
}

contract Session: { # An active authentication session
    sessionToken: readonly string(max=255) # Opaque session token used as the cache key and embedded in JWTs
    actorId: readonly uuid # The actor that owns this session
    issuedAt: readonly datetime # When the session was originally issued
    expiresAt: readonly datetime # When the session expires
    lastAccessedAt: readonly datetime # When the session was last accessed
    factors: readonly array(SessionFactor) # Factors that have been satisfied in this session
    ip?: readonly string(max=64) | null # IP address recorded when the session was created
    userAgent?: readonly string(max=512) | null # User agent recorded when the session was created
    isCurrent: readonly boolean # True when this session matches the requesting session
}

contract SessionRevoke: { # Optional metadata supplied to a revoke action
    reason?: string(max=255) | null # Free-form reason recorded with the revoke
}

contract Login: { # A successful authentication record
    id: readonly bigint # The login event identifier
    actorId: readonly uuid # The actor that authenticated
    factorType: readonly enum(phone, password, authenticator, email, fido, oidc) # The factor that satisfied the primary authentication
    factorId?: readonly uuid | null # The specific factor record id, when available
    sessionToken?: readonly string(max=255) | null # The session minted at this login, when available
    mfaSatisfied: readonly boolean # Whether MFA was required and satisfied at login
    ip?: readonly string(max=64) | null # IP address recorded at login
    userAgent?: readonly string(max=512) | null # User agent recorded at login
    occurredAt: readonly datetime # When the login occurred
}

contract ActorPreferences: { # The current user's display preferences, auto-detected by the SPA from the browser (Intl timezone + navigator.language). Omitted fields are left unchanged (absent = never set).
    locale?: string(max=32) # RFC 5646 locale, e.g. "en-US"
    timezone?: string(max=64) # Olson timezone, e.g. "America/New_York"
}
