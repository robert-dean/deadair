import { Decimal } from 'decimal.js';
import { DateTime } from 'luxon';

Decimal.set({ toExpNeg: -9e15, toExpPos: 9e15 });
const __dt = (v: unknown, path: string): DateTime => {
    if (typeof v !== 'string') {
        throw new TypeError(`ContractKit: expected an ISO 8601 string at '${path}', received ${typeof v}.`);
    }
    const d = DateTime.fromISO(v);
    if (!d.isValid) throw new TypeError(`ContractKit: '${v}' at '${path}' is not a valid ISO 8601 datetime.`);
    return d;
};

/**
 * Denotes the authorization flow to use
 * generated from [AuthenticationGrantType](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L7)
 */
export type AuthenticationGrantType = 'client_credentials' | 'password' | 'refresh_token' | 'link' | 'code' | 'fido' | 'authenticator' | 'oidc';

/**
 * Denotes the authorization flow to use
 * generated from [PasswordlessAuthenticationGrantType](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L18)
 */
export type PasswordlessAuthenticationGrantType = 'link' | 'code' | 'fido' | 'oidc';

/**
 * The type of the factor
 * generated from [AuthenticationFactorMethod](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L20)
 */
export type AuthenticationFactorMethod = 'phone' | 'password' | 'email' | 'authenticator' | 'fido' | 'oidc';

/**
 * The kind of the factor
 * generated from [AuthenticationFactorKind](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L22)
 */
export type AuthenticationFactorKind = 'knowledge' | 'possession' | 'biometric';

/**
 * The OIDC identity provider
 * generated from [OidcProvider](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L24)
 */
export type OidcProvider = 'google';

/**
 * Represents an authentication token
 * generated from [AuthenticationToken](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L84)
 */
export interface AuthenticationToken {
    /** The access token string as issued by the authorization server */
    accessToken: string;
    /** A refresh token which applications can use to obtain another access token */
    refreshToken?: string;
    /** Unix timestamp (seconds) when the access token expires */
    expiresIn: number;
    /** The type of token this is, typically just the string *Bearer* */
    tokenType: string;
    /** Space-separated list of scopes granted to this token */
    scope: string;
}

export interface AuthenticationTokenOutput {
    /** The access token string as issued by the authorization server */
    access_token: string;
    /** A refresh token which applications can use to obtain another access token */
    refresh_token?: string;
    /** Unix timestamp (seconds) when the access token expires */
    expires_in: number;
    /** The type of token this is, typically just the string *Bearer* */
    token_type: string;
    /** Space-separated list of scopes granted to this token */
    scope: string;
}

/**
 * Issued-token arm of /auth/token response
 * generated from [AuthenticationTokenIssued](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L92)
 */
export interface AuthenticationTokenIssued {
    /** Discriminator */
    result: 'token';
    /** The access token string as issued by the authorization server */
    accessToken: string;
    /** A refresh token which applications can use to obtain another access token */
    refreshToken?: string;
    /** Unix timestamp (seconds) when the access token expires */
    expiresIn: number;
    /** The type of token this is, typically just the string *Bearer* */
    tokenType: string;
    /** Space-separated list of scopes granted to this token */
    scope: string;
}

export interface AuthenticationTokenIssuedOutput {
    /** Discriminator */
    result: 'token';
    /** The access token string as issued by the authorization server */
    access_token: string;
    /** A refresh token which applications can use to obtain another access token */
    refresh_token?: string;
    /** Unix timestamp (seconds) when the access token expires */
    expires_in: number;
    /** The type of token this is, typically just the string *Bearer* */
    token_type: string;
    /** Space-separated list of scopes granted to this token */
    scope: string;
}

/**
 * Returned by /auth/step-up/start when no enrolled factor satisfies the requirement. The SPA should drive the user through enrollment and retry the gated action afterwards.
 * generated from [EnrollmentRequiredResponse](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L115)
 */
export interface EnrollmentRequiredResponse {
    /** Discriminator */
    result: 'enrollment_required';
}

export interface EnrollmentRequiredResponseOutput {
    /** Discriminator */
    result: 'enrollment_required';
}

/**
 * Represents a common shape of a `PublicKeyCredential` after the client serializes the `id` and `rawId` fields to base64 strings for transport
 * generated from [PublicKeyCredential](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L123)
 */
export interface PublicKeyCredential {
    /** The base64url encoding of `rawId` */
    id: string;
    /** This enumeration defines the valid credential types. It is an extension point; values can be added to it in the future, as more credential types are defined. The values of this enumeration are used for versioning the Authentication Assertion and attestation structures according to the type of the authenticator. Currently one credential type is defined, namely `public-key`. */
    type: 'public-key';
    /** The credential identifier */
    rawId: string;
    /** The authenticator attachment */
    authenticatorAttachment?: 'cross-platform' | 'platform';
}

/**
 * Subset of the WebAuthn client extension results the service round-trips
 * generated from [SimpleClientExtensionResults](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L130)
 */
export interface SimpleClientExtensionResults {
    /** Whether the client is an application */
    appid?: boolean;
    /** Whether the client is excluded from appid verification */
    appidExclude?: boolean;
    credProps?: { rk: boolean };
}

/**
 * generated from [FidoAuthenticatorAssertionResponse](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L138)
 */
export interface FidoAuthenticatorAssertionResponse {
    /** The client data JSON */
    clientDataJSON: string;
    /** The authenticator data */
    authenticatorData: string;
    /** The signature */
    signature: string;
    /** The user handle */
    userHandle?: string;
}

/**
 * generated from [AuthenticationRegistration](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L150)
 */
export interface AuthenticationRegistration {
    /** The registration identifier */
    registrationId: string;
    /** The registration expiration timestamp */
    expiresAt: DateTime;
}

export interface AuthenticationRegistrationInput {
    /** User's email address */
    email: string;
    /** optionally set a password for the user */
    password?: string;
}

/** Rehydrates every wire-encoded scalar in a AuthenticationRegistration into its runtime type. Mutates and returns `raw`. */
export function reviveAuthenticationRegistration(raw: AuthenticationRegistration): AuthenticationRegistration {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['expiresAt'] = __dt(__o0['expiresAt'], 'AuthenticationRegistration.expiresAt');
    return raw;
}

/**
 * generated from [AuthenticationRegistrationVerification](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L157)
 */
export interface AuthenticationRegistrationVerification {
    /** The registration identifier */
    registrationId: string;
    /** The verification code */
    code: string;
}

/**
 * A credential the relying party expects the user to be able to present
 * generated from [PublicKeyCredentialDescriptor](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L191)
 */
export interface PublicKeyCredentialDescriptor {
    /** The credential type — currently always `public-key` */
    type: 'public-key';
    /** The base64url-encoded credential identifier */
    id: string;
    /** Transports the authenticator advertises */
    transports?: ('usb' | 'nfc' | 'ble' | 'internal' | 'hybrid')[];
}

/**
 * The transport used by the authenticator
 * generated from [FidoAuthenticatorTransport](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L235)
 */
export type FidoAuthenticatorTransport = 'hybrid' | 'ble' | 'internal' | 'nfc' | 'usb';

/**
 * Response from `/auth/login/oidc/start` instructing the client to navigate to `authorize_url`
 * generated from [OidcLoginStartResponse](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L260)
 */
export interface OidcLoginStartResponse {
    /** Fully-formed authorize URL the user-agent should be redirected to */
    authorize_url: string;
    /** Opaque state token bound to this authorization round-trip */
    state: string;
    /** When the cached state record expires */
    expires_at: DateTime;
}

/** Rehydrates every wire-encoded scalar in a OidcLoginStartResponse into its runtime type. Mutates and returns `raw`. */
export function reviveOidcLoginStartResponse(raw: OidcLoginStartResponse): OidcLoginStartResponse {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['expires_at'] = __dt(__o0['expires_at'], 'OidcLoginStartResponse.expires_at');
    return raw;
}

/**
 * Request to complete an OIDC sign-in flow
 * generated from [OidcLoginCallback](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L266)
 */
export interface OidcLoginCallback {
    /** The issuer of the token */
    iss?: string;
    /** The scope of the token */
    scope?: string;
    /** The user ID */
    authuser?: string;
    /** The host domain */
    hd?: string;
    /** The prompt of the token */
    prompt?: string;
    /** The authorization code returned by the IdP (absent when the IdP rejected the request) */
    code?: string;
    /** The opaque state token bound to the original authorize request */
    state?: string;
    /** OAuth 2.0 error code per RFC 6749 §4.1.2.1 (e.g. access_denied) */
    error?: string;
    /** Human-readable explanation of `error` */
    error_description?: string;
    /** URL to a page describing `error` */
    error_uri?: string;
}

/**
 * Issue a phone SMS challenge during a pending MFA round
 * generated from [FactorChallengePhoneStart](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L279)
 */
export interface FactorChallengePhoneStart {
    /** Discriminator */
    method: 'phone';
    /** Delivery channel — only `sms` is supported in this phase */
    transport: 'sms';
    /** The MFA challenge to which this factor challenge is bound */
    mfa_challenge_id: string;
}

/**
 * Issue a WebAuthn assertion challenge during a pending MFA round
 * generated from [FactorChallengeFidoStart](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L285)
 */
export interface FactorChallengeFidoStart {
    /** Discriminator */
    method: 'fido';
    /** The MFA challenge to which this factor challenge is bound */
    mfa_challenge_id: string;
}

/**
 * Issue an email one-time-code challenge during a pending MFA round. Always a code: a magic link cannot complete an MFA round, since the `code` grant that redeems one takes `code(min=6, max=10)` and a link token is 43 characters
 * generated from [FactorChallengeEmailStart](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L290)
 */
export interface FactorChallengeEmailStart {
    /** Discriminator */
    method: 'email';
    /** The MFA challenge to which this factor challenge is bound */
    mfa_challenge_id: string;
}

/**
 * Response for a phone SMS challenge
 * generated from [FactorChallengePhoneStartResponse](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L297)
 */
export interface FactorChallengePhoneStartResponse {
    /** Discriminator */
    method: 'phone';
    /** Echo of the chosen delivery channel */
    transport: 'sms';
    /** The phone-factor challenge id — echo back on the `code` grant as `challenge_id` */
    phoneChallengeId: string;
    /** When the phone challenge expires */
    expiresAt: DateTime;
}

export interface FactorChallengePhoneStartResponseOutput {
    /** Discriminator */
    method: 'phone';
    /** Echo of the chosen delivery channel */
    transport: 'sms';
    /** The phone-factor challenge id — echo back on the `code` grant as `challenge_id` */
    phone_challenge_id: string;
    /** When the phone challenge expires */
    expires_at: DateTime;
}

/** Rehydrates every wire-encoded scalar in a FactorChallengePhoneStartResponse into its runtime type. Mutates and returns `raw`. */
export function reviveFactorChallengePhoneStartResponse(raw: FactorChallengePhoneStartResponse): FactorChallengePhoneStartResponse {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['expiresAt'] = __dt(__o0['expiresAt'], 'FactorChallengePhoneStartResponse.expiresAt');
    return raw;
}

/** Rehydrates every wire-encoded scalar in a FactorChallengePhoneStartResponseOutput into its runtime type. Mutates and returns `raw`. */
export function reviveFactorChallengePhoneStartResponseOutput(raw: FactorChallengePhoneStartResponseOutput): FactorChallengePhoneStartResponseOutput {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['expires_at'] = __dt(__o0['expires_at'], 'FactorChallengePhoneStartResponse.expires_at');
    return raw;
}

/**
 * Response for an email one-time-code challenge
 * generated from [FactorChallengeEmailStartResponse](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L311)
 */
export interface FactorChallengeEmailStartResponse {
    /** Discriminator */
    method: 'email';
    /** The email-factor challenge id — echo back on the `code` grant as `challenge_id` */
    emailChallengeId: string;
    /** When the email challenge expires */
    expiresAt: DateTime;
}

export interface FactorChallengeEmailStartResponseOutput {
    /** Discriminator */
    method: 'email';
    /** The email-factor challenge id — echo back on the `code` grant as `challenge_id` */
    email_challenge_id: string;
    /** When the email challenge expires */
    expires_at: DateTime;
}

/** Rehydrates every wire-encoded scalar in a FactorChallengeEmailStartResponse into its runtime type. Mutates and returns `raw`. */
export function reviveFactorChallengeEmailStartResponse(raw: FactorChallengeEmailStartResponse): FactorChallengeEmailStartResponse {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['expiresAt'] = __dt(__o0['expiresAt'], 'FactorChallengeEmailStartResponse.expiresAt');
    return raw;
}

/** Rehydrates every wire-encoded scalar in a FactorChallengeEmailStartResponseOutput into its runtime type. Mutates and returns `raw`. */
export function reviveFactorChallengeEmailStartResponseOutput(raw: FactorChallengeEmailStartResponseOutput): FactorChallengeEmailStartResponseOutput {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['expires_at'] = __dt(__o0['expires_at'], 'FactorChallengeEmailStartResponse.expires_at');
    return raw;
}

/**
 * A factor satisfied by the session
 * generated from [SessionFactor](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L325)
 */
export interface SessionFactor {
    /** The verification method */
    method: 'phone' | 'password' | 'authenticator' | 'email' | 'fido' | 'oidc';
    /** Stable identifier for the specific factor record */
    methodId: string;
    /** MFA category for the factor */
    kind: 'knowledge' | 'possession' | 'biometric';
    /** When this factor entry was first added to the session */
    issuedAt: DateTime;
    /** When the factor was most recently re-verified */
    authenticatedAt: DateTime;
}

export interface SessionFactorInput {
    /** The verification method */
    method: 'phone' | 'password' | 'authenticator' | 'email' | 'fido' | 'oidc';
    /** Stable identifier for the specific factor record */
    methodId: string;
    /** MFA category for the factor */
    kind: 'knowledge' | 'possession' | 'biometric';
}

/** Rehydrates every wire-encoded scalar in a SessionFactor into its runtime type. Mutates and returns `raw`. */
export function reviveSessionFactor(raw: SessionFactor): SessionFactor {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['issuedAt'] = __dt(__o0['issuedAt'], 'SessionFactor.issuedAt');
    __o0['authenticatedAt'] = __dt(__o0['authenticatedAt'], 'SessionFactor.authenticatedAt');
    return raw;
}

/**
 * Optional metadata supplied to a revoke action
 * generated from [SessionRevoke](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L345)
 */
export interface SessionRevoke {
    /** Free-form reason recorded with the revoke */
    reason?: string | null;
}

/**
 * A platform-wide role held on `platform:main`. `admin` grants every operation; `listener` grants the reads
 * generated from [PlatformRole](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L350)
 */
export type PlatformRole = 'admin' | 'listener';

/**
 * A successful authentication record
 * generated from [Login](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L357)
 */
export interface Login {
    /** The login event identifier */
    id: bigint;
    /** The actor that authenticated */
    actorId: string;
    /** The factor that satisfied the primary authentication */
    factorType: 'phone' | 'password' | 'authenticator' | 'email' | 'fido' | 'oidc';
    /** The specific factor record id, when available */
    factorId?: string | null;
    /** The session minted at this login, when available */
    sessionToken?: string | null;
    /** Whether MFA was required and satisfied at login */
    mfaSatisfied: boolean;
    /** IP address recorded at login */
    ip?: string | null;
    /** User agent recorded at login */
    userAgent?: string | null;
    /** When the login occurred */
    occurredAt: DateTime;
}

export interface LoginInput {}

/** Rehydrates every wire-encoded scalar in a Login into its runtime type. Mutates and returns `raw`. */
export function reviveLogin(raw: Login): Login {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['occurredAt'] = __dt(__o0['occurredAt'], 'Login.occurredAt');
    return raw;
}

/**
 * The current user's display preferences, auto-detected by the SPA from the browser (Intl timezone + navigator.language). Omitted fields are left unchanged (absent = never set).
 * generated from [ActorPreferences](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L369)
 */
export interface ActorPreferences {
    /** RFC 5646 locale, e.g. "en-US" */
    locale?: string;
    /** Olson timezone, e.g. "America/New_York" */
    timezone?: string;
}

/**
 * generated from [BaseAuthenticationRequest](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L26)
 */
export interface BaseAuthenticationRequest {
    /** The grant type for the request */
    grant_type: AuthenticationGrantType;
    /** The scope of the request */
    scope?: string;
    /** The application's client identifier, if available */
    client_id?: string;
}

/**
 * generated from [BaseAuthenticationLoginStart](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L162)
 */
export interface BaseAuthenticationLoginStart {
    /** The grant type for the request */
    grant_type: PasswordlessAuthenticationGrantType;
    /** The application's client identifier, if available */
    client_id?: string;
}

/**
 * generated from [BaseAuthenticationLoginStartResponse](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L197)
 */
export interface BaseAuthenticationLoginStartResponse {
    /** The grant type for the response */
    grant_type: PasswordlessAuthenticationGrantType;
    /** The challenge identifier */
    challengeId: string;
    /** The challenge expiration timestamp */
    expiresAt: DateTime;
}

/** Rehydrates every wire-encoded scalar in a BaseAuthenticationLoginStartResponse into its runtime type. Mutates and returns `raw`. */
export function reviveBaseAuthenticationLoginStartResponse(raw: BaseAuthenticationLoginStartResponse): BaseAuthenticationLoginStartResponse {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['expiresAt'] = __dt(__o0['expiresAt'], 'BaseAuthenticationLoginStartResponse.expiresAt');
    return raw;
}

/**
 * A factor the SPA may use to satisfy the MFA challenge
 * generated from [MfaChallengeFactor](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L101)
 */
export interface MfaChallengeFactor {
    /** The factor method */
    method: AuthenticationFactorMethod;
    /** The id of the enrolled factor (opaque to the SPA, must be echoed back in the proof for methods that don't bind another way) */
    methodId: string;
    /** The factor kind (knowledge, possession, biometric) — the SPA filters against step-up `acceptableKinds`/`excludeKinds` hints */
    kind: AuthenticationFactorKind;
    /** Optional human-readable label (e.g. provider name for OIDC, friendly name for FIDO) */
    label?: string;
}

export interface MfaChallengeFactorOutput {
    /** The factor method */
    method: AuthenticationFactorMethod;
    /** The id of the enrolled factor (opaque to the SPA, must be echoed back in the proof for methods that don't bind another way) */
    method_id: string;
    /** The factor kind (knowledge, possession, biometric) — the SPA filters against step-up `acceptableKinds`/`excludeKinds` hints */
    kind: AuthenticationFactorKind;
    /** Optional human-readable label (e.g. provider name for OIDC, friendly name for FIDO) */
    label?: string;
}

/**
 * generated from [AuthenticationFactor](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L248)
 */
export interface AuthenticationFactor {
    /** The method of the factor */
    method: AuthenticationFactorMethod;
    /** The kind of the factor */
    kind: AuthenticationFactorKind;
    /** The method identifier */
    methodId: string;
    /** The label for the factor */
    label?: string;
}

/**
 * Mint a fresh MFA challenge for the current session so the SPA can satisfy a `step_up_required` denial. Filters mirror `StepUpRequirement` from `@maroonedsoftware/policies`.
 * generated from [StepUpStartRequest](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L319)
 */
export interface StepUpStartRequest {
    /** If set, only these factor methods are listed as eligible */
    acceptableMethods?: AuthenticationFactorMethod[];
    /** If set, only these factor kinds are listed as eligible */
    acceptableKinds?: AuthenticationFactorKind[];
    /** If set, factors with these methods are never listed */
    excludeMethods?: AuthenticationFactorMethod[];
}

/**
 * Request to begin an OIDC sign-in flow
 * generated from [OidcLoginStart](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L255)
 */
export interface OidcLoginStart {
    /** The IdP to authorize against */
    provider: OidcProvider;
    /** Optional URL the SPA wants the callback to land on after token issuance */
    redirect_after?: string;
}

/**
 * generated from [PublicKeyCredentialWithAssertion](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L145)
 */
export interface PublicKeyCredentialWithAssertion extends PublicKeyCredential {
    /** The client extension results */
    clientExtensionResults: SimpleClientExtensionResults;
    /** The authenticator assertion response */
    response: FidoAuthenticatorAssertionResponse;
}

/**
 * generated from [FidoPublicKeyCredentialRequestOptions](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L211)
 */
export interface FidoPublicKeyCredentialRequestOptions {
    challenge: string;
    /** WebAuthn timeout hint in milliseconds */
    timeout?: number;
    rpId?: string;
    /** The attestation */
    attestation?: 'direct' | 'indirect' | 'none';
    /** Whether the authenticator must verify the user */
    userVerification?: 'required' | 'preferred' | 'discouraged';
    /** The raw challenge */
    rawChallenge?: Blob;
    extensions?: Record<string, unknown>;
    allowCredentials?: PublicKeyCredentialDescriptor[];
}

/**
 * Serialized form of `AuthenticatorAttestationResponse` — produced by the browser at registration; all binary fields are base64-encoded for transport
 * generated from [FidoAuthenticatorAttestationResponse](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L237)
 */
export interface FidoAuthenticatorAttestationResponse {
    /** The client data JSON */
    clientDataJSON: string;
    /** The attestation object */
    attestationObject: string;
    /** The transports used by the authenticator */
    transports?: FidoAuthenticatorTransport[];
}

/**
 * generated from [FactorChallengeStartRequest](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L295)
 */
export type FactorChallengeStartRequest = FactorChallengePhoneStart | FactorChallengeFidoStart | FactorChallengeEmailStart;

/**
 * An active authentication session
 * generated from [Session](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L333)
 */
export interface Session {
    /** Opaque session token used as the cache key and embedded in JWTs */
    sessionToken: string;
    /** The actor that owns this session */
    actorId: string;
    /** When the session was originally issued */
    issuedAt: DateTime;
    /** When the session expires */
    expiresAt: DateTime;
    /** When the session was last accessed */
    lastAccessedAt: DateTime;
    /** Factors that have been satisfied in this session */
    factors: SessionFactor[];
    /** IP address recorded when the session was created */
    ip?: string | null;
    /** User agent recorded when the session was created */
    userAgent?: string | null;
    /** True when this session matches the requesting session */
    isCurrent: boolean;
}

export interface SessionInput {}

/** Rehydrates every wire-encoded scalar in a Session into its runtime type. Mutates and returns `raw`. */
export function reviveSession(raw: Session): Session {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['issuedAt'] = __dt(__o0['issuedAt'], 'Session.issuedAt');
    __o0['expiresAt'] = __dt(__o0['expiresAt'], 'Session.expiresAt');
    __o0['lastAccessedAt'] = __dt(__o0['lastAccessedAt'], 'Session.lastAccessedAt');
    {
        const __a1 = __o0['factors'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveSessionFactor(__a1[__i2] as never);
        }
    }
    return raw;
}

/**
 * Who the caller is, as the station sees them
 * generated from [AuthSession](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L352)
 */
export interface AuthSession {
    /** The actor the session belongs to */
    actorId: string;
    /** Every platform role the caller holds, sorted. Empty for an account nobody has granted one, which today is any account that did not come in through onboarding */
    roles: PlatformRole[];
}

/**
 * Represents an application authentication request
 * generated from [ClientCredentialsAuthenticationRequest](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L32)
 */
export interface ClientCredentialsAuthenticationRequest extends Omit<BaseAuthenticationRequest, 'grant_type' | 'client_id'> {
    /** The grant type for the request */
    grant_type: 'client_credentials';
    /** The client identifier */
    client_id: string;
    /** The client secret */
    client_secret: string;
}

/**
 * Represents an authentication password request
 * generated from [PasswordAuthenticationRequest](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L38)
 */
export interface PasswordAuthenticationRequest extends Omit<BaseAuthenticationRequest, 'grant_type'> {
    /** The grant type for the request */
    grant_type: 'password';
    /** User's identifier, usually an email address */
    username: string;
    /** User's password */
    password: string;
}

/**
 * Represents an authentication refresh request
 * generated from [RefreshTokenAuthenticationRequest](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L44)
 */
export interface RefreshTokenAuthenticationRequest extends Omit<BaseAuthenticationRequest, 'grant_type'> {
    /** The grant type for the request */
    grant_type: 'refresh_token';
    /** The refresh token issued by the authorization server. Optional: browser clients omit it and present the httpOnly refresh cookie instead */
    refresh_token?: string;
}

/**
 * Represents an authentication magic link request
 * generated from [LinkAuthenticationRequest](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L49)
 */
export interface LinkAuthenticationRequest extends Omit<BaseAuthenticationRequest, 'grant_type'> {
    /** The grant type for the request */
    grant_type: 'link';
    /** The email challenge id returned by `POST /auth/login/start` — binds the link to the issued challenge so cross-device clicks work */
    challenge_id: string;
    /** The magic link token */
    link: string;
}

/**
 * Represents an authentication one-time-code request
 * generated from [CodeAuthenticationRequest](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L55)
 */
export interface CodeAuthenticationRequest extends Omit<BaseAuthenticationRequest, 'grant_type'> {
    /** The grant type for the request */
    grant_type: 'code';
    /** The one-time code */
    code: string;
    /** PKCE verifier — required for a primary code login; absent when mfa_challenge_id is set */
    code_verifier?: string;
    /** When set, completes a pending MFA challenge; replaces code_verifier as proof-of-origin */
    mfa_challenge_id?: string;
    /** The phone/email challenge id (returned by POST /auth/factors/start for phone-MFA). Required when mfa_challenge_id is set; ignored otherwise (resolved via PKCE) */
    challenge_id?: string;
}

/**
 * Submit a TOTP code as a second factor against a pending MFA challenge
 * generated from [AuthenticatorAuthenticationRequest](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L70)
 */
export interface AuthenticatorAuthenticationRequest extends Omit<BaseAuthenticationRequest, 'grant_type'> {
    /** The grant type for the request */
    grant_type: 'authenticator';
    /** The TOTP code */
    code: string;
    /** The pending MFA challenge — required, TOTP has no other actor binding at initial login */
    mfa_challenge_id: string;
    /** The id of the enrolled authenticator factor to verify against (must be present in the MFA challenge's eligible list) */
    method_id: string;
}

/**
 * Redeem a completed OIDC authorization that the callback stashed under a one-time id
 * generated from [OidcAuthenticationRequest](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L77)
 */
export interface OidcAuthenticationRequest extends Omit<BaseAuthenticationRequest, 'grant_type'> {
    /** The grant type for the request */
    grant_type: 'oidc';
    /** The one-time stash id from the OIDC callback redirect (the value after `?token=oidc:` on `/auth/callback`). Single-use — the API consumes it via `OidcFactorService.redeemAuthenticatedExchange`. */
    challenge_id: string;
}

/**
 * generated from [BaseAuthenticationLoginStartWithEmail](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L167)
 */
export interface BaseAuthenticationLoginStartWithEmail extends BaseAuthenticationLoginStart {
    /** User's email address */
    email: string;
}

/**
 * Request to begin an OIDC sign-in flow
 * generated from [OidcAuthenticationLoginStart](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L184)
 */
export interface OidcAuthenticationLoginStart extends Omit<BaseAuthenticationLoginStart, 'grant_type'> {
    /** The grant type for the request */
    grant_type: 'oidc';
    /** The IdP to authorize against */
    provider: OidcProvider;
}

/**
 * generated from [CodeAuthenticationLoginStartResponse](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L203)
 */
export interface CodeAuthenticationLoginStartResponse extends Omit<BaseAuthenticationLoginStartResponse, 'grant_type'> {
    /** The grant type for the response */
    grant_type: 'code';
}

/** Rehydrates every wire-encoded scalar in a CodeAuthenticationLoginStartResponse into its runtime type. Mutates and returns `raw`. */
export function reviveCodeAuthenticationLoginStartResponse(raw: CodeAuthenticationLoginStartResponse): CodeAuthenticationLoginStartResponse {
    reviveBaseAuthenticationLoginStartResponse(raw as never);
    return raw;
}

/**
 * generated from [LinkAuthenticationLoginStartResponse](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L207)
 */
export interface LinkAuthenticationLoginStartResponse extends Omit<BaseAuthenticationLoginStartResponse, 'grant_type'> {
    /** The grant type for the response */
    grant_type: 'link';
}

/** Rehydrates every wire-encoded scalar in a LinkAuthenticationLoginStartResponse into its runtime type. Mutates and returns `raw`. */
export function reviveLinkAuthenticationLoginStartResponse(raw: LinkAuthenticationLoginStartResponse): LinkAuthenticationLoginStartResponse {
    reviveBaseAuthenticationLoginStartResponse(raw as never);
    return raw;
}

/**
 * Response from `/auth/login/oidc/start` instructing the client to navigate to `authorize_url`
 * generated from [OidcAuthenticationLoginStartResponse](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L227)
 */
export interface OidcAuthenticationLoginStartResponse extends Omit<BaseAuthenticationLoginStartResponse, 'grant_type'> {
    /** The grant type for the response */
    grant_type: 'oidc';
    /** Fully-formed authorize URL the user-agent should be redirected to */
    authorize_url: string;
    /** Opaque state token bound to this authorization round-trip */
    state: string;
}

/** Rehydrates every wire-encoded scalar in a OidcAuthenticationLoginStartResponse into its runtime type. Mutates and returns `raw`. */
export function reviveOidcAuthenticationLoginStartResponse(raw: OidcAuthenticationLoginStartResponse): OidcAuthenticationLoginStartResponse {
    reviveBaseAuthenticationLoginStartResponse(raw as never);
    return raw;
}

/**
 * MFA-required arm of /auth/token response
 * generated from [MfaRequiredResponse](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L108)
 */
export interface MfaRequiredResponse {
    /** Discriminator */
    result: 'mfa_required';
    /** The MFA challenge identifier — pass back as `mfa_challenge_id` on the proof grant */
    challengeId: string;
    /** When the MFA challenge expires */
    expiresAt: DateTime;
    /** Eligible factors the SPA may use to complete the challenge */
    factors: MfaChallengeFactor[];
}

export interface MfaRequiredResponseOutput {
    /** Discriminator */
    result: 'mfa_required';
    /** The MFA challenge identifier — pass back as `mfa_challenge_id` on the proof grant */
    challenge_id: string;
    /** When the MFA challenge expires */
    expires_at: DateTime;
    /** Eligible factors the SPA may use to complete the challenge */
    factors: MfaChallengeFactorOutput[];
}

/** Rehydrates every wire-encoded scalar in a MfaRequiredResponse into its runtime type. Mutates and returns `raw`. */
export function reviveMfaRequiredResponse(raw: MfaRequiredResponse): MfaRequiredResponse {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['expiresAt'] = __dt(__o0['expiresAt'], 'MfaRequiredResponse.expiresAt');
    return raw;
}

/** Rehydrates every wire-encoded scalar in a MfaRequiredResponseOutput into its runtime type. Mutates and returns `raw`. */
export function reviveMfaRequiredResponseOutput(raw: MfaRequiredResponseOutput): MfaRequiredResponseOutput {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['expires_at'] = __dt(__o0['expires_at'], 'MfaRequiredResponse.expires_at');
    return raw;
}

/**
 * Represents an authentication passkey request
 * generated from [FidoAuthenticationRequest](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L63)
 */
export interface FidoAuthenticationRequest extends Omit<BaseAuthenticationRequest, 'grant_type'> {
    /** The grant type for the request */
    grant_type: 'fido';
    /** A passkey credential object */
    credential: PublicKeyCredentialWithAssertion;
    /** The FIDO assertion challenge id returned by `POST /auth/login/start` (primary) or `POST /auth/factors/start` (MFA second factor). Must be the per-challenge id, not the actor id. */
    challenge_id: string;
    /** When set, completes a pending MFA challenge instead of issuing a single-factor session */
    mfa_challenge_id?: string;
}

/**
 * WebAuthn assertion options for `navigator.credentials.get`
 * generated from [FidoAuthenticationLoginStartResponse](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L222)
 */
export interface FidoAuthenticationLoginStartResponse extends Omit<BaseAuthenticationLoginStartResponse, 'grant_type'> {
    /** The grant type for the response */
    grant_type: 'fido';
    /** The WebAuthn assertion options */
    assertion: FidoPublicKeyCredentialRequestOptions;
}

/** Rehydrates every wire-encoded scalar in a FidoAuthenticationLoginStartResponse into its runtime type. Mutates and returns `raw`. */
export function reviveFidoAuthenticationLoginStartResponse(raw: FidoAuthenticationLoginStartResponse): FidoAuthenticationLoginStartResponse {
    reviveBaseAuthenticationLoginStartResponse(raw as never);
    return raw;
}

/**
 * Response for a FIDO assertion challenge
 * generated from [FactorChallengeFidoStartResponse](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L304)
 */
export interface FactorChallengeFidoStartResponse {
    /** Discriminator */
    method: 'fido';
    /** The FIDO-factor challenge id — echo back on the `fido` grant as `challenge_id` */
    fidoChallengeId: string;
    /** WebAuthn assertion options for navigator.credentials.get */
    assertion: FidoPublicKeyCredentialRequestOptions;
    /** When the FIDO challenge expires */
    expiresAt: DateTime;
}

export interface FactorChallengeFidoStartResponseOutput {
    /** Discriminator */
    method: 'fido';
    /** The FIDO-factor challenge id — echo back on the `fido` grant as `challenge_id` */
    fido_challenge_id: string;
    /** WebAuthn assertion options for navigator.credentials.get */
    assertion: FidoPublicKeyCredentialRequestOptions;
    /** When the FIDO challenge expires */
    expires_at: DateTime;
}

/** Rehydrates every wire-encoded scalar in a FactorChallengeFidoStartResponse into its runtime type. Mutates and returns `raw`. */
export function reviveFactorChallengeFidoStartResponse(raw: FactorChallengeFidoStartResponse): FactorChallengeFidoStartResponse {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['expiresAt'] = __dt(__o0['expiresAt'], 'FactorChallengeFidoStartResponse.expiresAt');
    return raw;
}

/** Rehydrates every wire-encoded scalar in a FactorChallengeFidoStartResponseOutput into its runtime type. Mutates and returns `raw`. */
export function reviveFactorChallengeFidoStartResponseOutput(raw: FactorChallengeFidoStartResponseOutput): FactorChallengeFidoStartResponseOutput {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['expires_at'] = __dt(__o0['expires_at'], 'FactorChallengeFidoStartResponse.expires_at');
    return raw;
}

/**
 * The credential the client posts back to complete registration
 * generated from [PublicKeyCredentialWithAttestation](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L243)
 */
export interface PublicKeyCredentialWithAttestation extends PublicKeyCredential {
    /** The client extension results */
    clientExtensionResults: SimpleClientExtensionResults;
    /** The authenticator attestation response */
    response: FidoAuthenticatorAttestationResponse;
}

/**
 * generated from [LinkAuthenticationLoginStart](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L171)
 */
export interface LinkAuthenticationLoginStart extends Omit<BaseAuthenticationLoginStartWithEmail, 'grant_type'> {
    /** The grant type for the request */
    grant_type: 'link';
}

/**
 * generated from [CodeAuthenticationLoginStart](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L175)
 */
export interface CodeAuthenticationLoginStart extends Omit<BaseAuthenticationLoginStartWithEmail, 'grant_type'> {
    /** The grant type for the request */
    grant_type: 'code';
    /** A base64url encoded SHA256 hash of a one time secret used to validate that the request starts and ends on the same device */
    code_challenge: string;
}

/**
 * generated from [FidoAuthenticationLoginStart](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L180)
 */
export interface FidoAuthenticationLoginStart extends Omit<BaseAuthenticationLoginStartWithEmail, 'grant_type'> {
    /** The grant type for the request */
    grant_type: 'fido';
}

/**
 * generated from [StepUpStartResponse](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L119)
 */
export type StepUpStartResponse = MfaRequiredResponse | EnrollmentRequiredResponse;
export type StepUpStartResponseOutput = MfaRequiredResponseOutput | EnrollmentRequiredResponseOutput;

/** Rehydrates every wire-encoded scalar in a StepUpStartResponse into its runtime type. Mutates and returns `raw`. */
export function reviveStepUpStartResponse(raw: StepUpStartResponse): StepUpStartResponse {
    const __v = [raw] as unknown[];
    {
        const __d0 = (__v[0] as Record<string, unknown>)['result'];
        if (__d0 === 'mfa_required') {
            reviveMfaRequiredResponse(__v[0] as never);
        }
    }
    return __v[0] as StepUpStartResponse;
}

/** Rehydrates every wire-encoded scalar in a StepUpStartResponseOutput into its runtime type. Mutates and returns `raw`. */
export function reviveStepUpStartResponseOutput(raw: StepUpStartResponseOutput): StepUpStartResponseOutput {
    const __v = [raw] as unknown[];
    {
        const __d0 = (__v[0] as Record<string, unknown>)['result'];
        if (__d0 === 'mfa_required') {
            reviveMfaRequiredResponseOutput(__v[0] as never);
        }
    }
    return __v[0] as StepUpStartResponseOutput;
}

/**
 * generated from [AuthenticationTokenResponse](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L121)
 */
export type AuthenticationTokenResponse = AuthenticationTokenIssued | MfaRequiredResponse;
export type AuthenticationTokenResponseOutput = AuthenticationTokenIssuedOutput | MfaRequiredResponseOutput;

/** Rehydrates every wire-encoded scalar in a AuthenticationTokenResponse into its runtime type. Mutates and returns `raw`. */
export function reviveAuthenticationTokenResponse(raw: AuthenticationTokenResponse): AuthenticationTokenResponse {
    const __v = [raw] as unknown[];
    {
        const __d0 = (__v[0] as Record<string, unknown>)['result'];
        if (__d0 === 'mfa_required') {
            reviveMfaRequiredResponse(__v[0] as never);
        }
    }
    return __v[0] as AuthenticationTokenResponse;
}

/** Rehydrates every wire-encoded scalar in a AuthenticationTokenResponseOutput into its runtime type. Mutates and returns `raw`. */
export function reviveAuthenticationTokenResponseOutput(raw: AuthenticationTokenResponseOutput): AuthenticationTokenResponseOutput {
    const __v = [raw] as unknown[];
    {
        const __d0 = (__v[0] as Record<string, unknown>)['result'];
        if (__d0 === 'mfa_required') {
            reviveMfaRequiredResponseOutput(__v[0] as never);
        }
    }
    return __v[0] as AuthenticationTokenResponseOutput;
}

/**
 * generated from [AuthenticationRequest](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L82)
 */
export type AuthenticationRequest =
    | PasswordAuthenticationRequest
    | ClientCredentialsAuthenticationRequest
    | RefreshTokenAuthenticationRequest
    | LinkAuthenticationRequest
    | CodeAuthenticationRequest
    | FidoAuthenticationRequest
    | AuthenticatorAuthenticationRequest
    | OidcAuthenticationRequest;

/**
 * generated from [AuthenticationLoginStartResponse](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L233)
 */
export type AuthenticationLoginStartResponse =
    | CodeAuthenticationLoginStartResponse
    | LinkAuthenticationLoginStartResponse
    | FidoAuthenticationLoginStartResponse
    | OidcAuthenticationLoginStartResponse;

/** Rehydrates every wire-encoded scalar in a AuthenticationLoginStartResponse into its runtime type. Mutates and returns `raw`. */
export function reviveAuthenticationLoginStartResponse(raw: AuthenticationLoginStartResponse): AuthenticationLoginStartResponse {
    const __v = [raw] as unknown[];
    {
        const __d0 = (__v[0] as Record<string, unknown>)['grant_type'];
        if (__d0 === 'code') {
            reviveCodeAuthenticationLoginStartResponse(__v[0] as never);
        }
        if (__d0 === 'link') {
            reviveLinkAuthenticationLoginStartResponse(__v[0] as never);
        }
        if (__d0 === 'fido') {
            reviveFidoAuthenticationLoginStartResponse(__v[0] as never);
        }
        if (__d0 === 'oidc') {
            reviveOidcAuthenticationLoginStartResponse(__v[0] as never);
        }
    }
    return __v[0] as AuthenticationLoginStartResponse;
}

/**
 * generated from [FactorChallengeStartResponse](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L317)
 */
export type FactorChallengeStartResponse = FactorChallengePhoneStartResponse | FactorChallengeFidoStartResponse | FactorChallengeEmailStartResponse;
export type FactorChallengeStartResponseOutput =
    FactorChallengePhoneStartResponseOutput | FactorChallengeFidoStartResponseOutput | FactorChallengeEmailStartResponseOutput;

/** Rehydrates every wire-encoded scalar in a FactorChallengeStartResponse into its runtime type. Mutates and returns `raw`. */
export function reviveFactorChallengeStartResponse(raw: FactorChallengeStartResponse): FactorChallengeStartResponse {
    const __v = [raw] as unknown[];
    {
        const __d0 = (__v[0] as Record<string, unknown>)['method'];
        if (__d0 === 'phone') {
            reviveFactorChallengePhoneStartResponse(__v[0] as never);
        }
        if (__d0 === 'fido') {
            reviveFactorChallengeFidoStartResponse(__v[0] as never);
        }
        if (__d0 === 'email') {
            reviveFactorChallengeEmailStartResponse(__v[0] as never);
        }
    }
    return __v[0] as FactorChallengeStartResponse;
}

/** Rehydrates every wire-encoded scalar in a FactorChallengeStartResponseOutput into its runtime type. Mutates and returns `raw`. */
export function reviveFactorChallengeStartResponseOutput(raw: FactorChallengeStartResponseOutput): FactorChallengeStartResponseOutput {
    const __v = [raw] as unknown[];
    {
        const __d0 = (__v[0] as Record<string, unknown>)['method'];
        if (__d0 === 'phone') {
            reviveFactorChallengePhoneStartResponseOutput(__v[0] as never);
        }
        if (__d0 === 'fido') {
            reviveFactorChallengeFidoStartResponseOutput(__v[0] as never);
        }
        if (__d0 === 'email') {
            reviveFactorChallengeEmailStartResponseOutput(__v[0] as never);
        }
    }
    return __v[0] as FactorChallengeStartResponseOutput;
}

/**
 * generated from [AuthenticationLoginStart](../../../../../apps/api/data/contracts/authentication/authentication.types.ck#L189)
 */
export type AuthenticationLoginStart =
    LinkAuthenticationLoginStart | CodeAuthenticationLoginStart | FidoAuthenticationLoginStart | OidcAuthenticationLoginStart;
