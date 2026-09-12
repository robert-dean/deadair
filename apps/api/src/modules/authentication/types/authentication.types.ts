import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodBinary = z.custom<Buffer>(val => Buffer.isBuffer(val), { error: 'Must be binary data' });
const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * Denotes the authorization flow to use
 * generated from [AuthenticationGrantType](../../../../data/contracts/authentication/authentication.types.ck#L7)
 */
export const AuthenticationGrantType = z.enum(['client_credentials', 'password', 'refresh_token', 'link', 'code', 'fido', 'authenticator', 'oidc']);
export type AuthenticationGrantType = z.infer<typeof AuthenticationGrantType>;

/**
 * Denotes the authorization flow to use
 * generated from [PasswordlessAuthenticationGrantType](../../../../data/contracts/authentication/authentication.types.ck#L18)
 */
export const PasswordlessAuthenticationGrantType = z.enum(['link', 'code', 'fido', 'oidc']);
export type PasswordlessAuthenticationGrantType = z.infer<typeof PasswordlessAuthenticationGrantType>;

/**
 * The type of the factor
 * generated from [AuthenticationFactorMethod](../../../../data/contracts/authentication/authentication.types.ck#L20)
 */
export const AuthenticationFactorMethod = z.enum(['phone', 'password', 'email', 'authenticator', 'fido', 'oidc']);
export type AuthenticationFactorMethod = z.infer<typeof AuthenticationFactorMethod>;

/**
 * The kind of the factor
 * generated from [AuthenticationFactorKind](../../../../data/contracts/authentication/authentication.types.ck#L22)
 */
export const AuthenticationFactorKind = z.enum(['knowledge', 'possession', 'biometric']);
export type AuthenticationFactorKind = z.infer<typeof AuthenticationFactorKind>;

/**
 * The OIDC identity provider
 * generated from [OidcProvider](../../../../data/contracts/authentication/authentication.types.ck#L24)
 */
export const OidcProvider = z.enum(['google']);
export type OidcProvider = z.infer<typeof OidcProvider>;

/**
 * Represents an authentication token
 * generated from [AuthenticationToken](../../../../data/contracts/authentication/authentication.types.ck#L84)
 */
export const AuthenticationToken = z
    .strictObject({
        accessToken: z.string().describe('The access token string as issued by the authorization server'),
        refreshToken: z.string().optional().describe('A refresh token which applications can use to obtain another access token'),
        expiresIn: z
            .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int())
            .describe('Unix timestamp (seconds) when the access token expires'),
        tokenType: z.string().describe('The type of token this is, typically just the string *Bearer*'),
        scope: z.string().describe('Space-separated list of scopes granted to this token'),
    })
    .transform(data => ({
        access_token: data.accessToken,
        ...(data.refreshToken !== undefined ? { refresh_token: data.refreshToken } : {}),
        expires_in: data.expiresIn,
        token_type: data.tokenType,
        scope: data.scope,
    }));
export type AuthenticationToken = z.input<typeof AuthenticationToken>;
export type AuthenticationTokenOutput = z.output<typeof AuthenticationToken>;

/**
 * Issued-token arm of /auth/token response
 * generated from [AuthenticationTokenIssued](../../../../data/contracts/authentication/authentication.types.ck#L92)
 */
export const AuthenticationTokenIssued = z
    .strictObject({
        result: z.literal('token').describe('Discriminator'),
        accessToken: z.string().describe('The access token string as issued by the authorization server'),
        refreshToken: z.string().optional().describe('A refresh token which applications can use to obtain another access token'),
        expiresIn: z
            .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int())
            .describe('Unix timestamp (seconds) when the access token expires'),
        tokenType: z.string().describe('The type of token this is, typically just the string *Bearer*'),
        scope: z.string().describe('Space-separated list of scopes granted to this token'),
    })
    .transform(data => ({
        result: data.result,
        access_token: data.accessToken,
        ...(data.refreshToken !== undefined ? { refresh_token: data.refreshToken } : {}),
        expires_in: data.expiresIn,
        token_type: data.tokenType,
        scope: data.scope,
    }));
export type AuthenticationTokenIssued = z.input<typeof AuthenticationTokenIssued>;
export type AuthenticationTokenIssuedOutput = z.output<typeof AuthenticationTokenIssued>;

/**
 * Returned by /auth/step-up/start when no enrolled factor satisfies the requirement. The SPA should drive the user through enrollment and retry the gated action afterwards.
 * generated from [EnrollmentRequiredResponse](../../../../data/contracts/authentication/authentication.types.ck#L115)
 */
export const EnrollmentRequiredResponse = z
    .strictObject({
        result: z.literal('enrollment_required').describe('Discriminator'),
    })
    .transform(data => ({
        result: data.result,
    }));
export type EnrollmentRequiredResponse = z.input<typeof EnrollmentRequiredResponse>;
export type EnrollmentRequiredResponseOutput = z.output<typeof EnrollmentRequiredResponse>;

/**
 * Represents a common shape of a `PublicKeyCredential` after the client serializes the `id` and `rawId` fields to base64 strings for transport
 * generated from [PublicKeyCredential](../../../../data/contracts/authentication/authentication.types.ck#L123)
 */
export const PublicKeyCredential = z.strictObject({
    id: z.string().describe('The base64url encoding of `rawId`'),
    type: z
        .literal('public-key')
        .describe(
            'This enumeration defines the valid credential types. It is an extension point; values can be added to it in the future, as more credential types are defined. The values of this enumeration are used for versioning the Authentication Assertion and attestation structures according to the type of the authenticator. Currently one credential type is defined, namely `public-key`.',
        ),
    rawId: z.string().describe('The credential identifier'),
    authenticatorAttachment: z.enum(['cross-platform', 'platform']).optional().describe('The authenticator attachment'),
});
export type PublicKeyCredential = z.infer<typeof PublicKeyCredential>;

/**
 * Subset of the WebAuthn client extension results the service round-trips
 * generated from [SimpleClientExtensionResults](../../../../data/contracts/authentication/authentication.types.ck#L130)
 */
export const SimpleClientExtensionResults = z.strictObject({
    appid: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .optional()
        .describe('Whether the client is an application'),
    appidExclude: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .optional()
        .describe('Whether the client is excluded from appid verification'),
    credProps: z
        .strictObject({
            rk: z
                .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
                .describe('Whether the client supports the rk extension'),
        })
        .optional(),
});
export type SimpleClientExtensionResults = z.infer<typeof SimpleClientExtensionResults>;

/**
 * generated from [FidoAuthenticatorAssertionResponse](../../../../data/contracts/authentication/authentication.types.ck#L138)
 */
export const FidoAuthenticatorAssertionResponse = z.strictObject({
    clientDataJSON: z.string().describe('The client data JSON'),
    authenticatorData: z.string().describe('The authenticator data'),
    signature: z.string().describe('The signature'),
    userHandle: z.string().optional().describe('The user handle'),
});
export type FidoAuthenticatorAssertionResponse = z.infer<typeof FidoAuthenticatorAssertionResponse>;

/**
 * generated from [AuthenticationRegistration](../../../../data/contracts/authentication/authentication.types.ck#L150)
 */
export const AuthenticationRegistration = z.strictObject({
    registrationId: z.string().describe('The registration identifier'),
    expiresAt: _ZodDatetime.describe('The registration expiration timestamp'),
});
export type AuthenticationRegistration = z.infer<typeof AuthenticationRegistration>;

export const AuthenticationRegistrationInput = z.strictObject({
    email: z.email().describe("User's email address"),
    password: z.string().min(8).max(256).optional().describe('optionally set a password for the user'),
});
export type AuthenticationRegistrationInput = z.infer<typeof AuthenticationRegistrationInput>;

/**
 * generated from [AuthenticationRegistrationVerification](../../../../data/contracts/authentication/authentication.types.ck#L157)
 */
export const AuthenticationRegistrationVerification = z.strictObject({
    registrationId: z.string().describe('The registration identifier'),
    code: z.string().min(6).max(10).describe('The verification code'),
});
export type AuthenticationRegistrationVerification = z.infer<typeof AuthenticationRegistrationVerification>;

/**
 * A credential the relying party expects the user to be able to present
 * generated from [PublicKeyCredentialDescriptor](../../../../data/contracts/authentication/authentication.types.ck#L191)
 */
export const PublicKeyCredentialDescriptor = z.strictObject({
    type: z.literal('public-key').describe('The credential type — currently always `public-key`'),
    id: z.string().describe('The base64url-encoded credential identifier'),
    transports: z
        .array(z.enum(['usb', 'nfc', 'ble', 'internal', 'hybrid']))
        .optional()
        .describe('Transports the authenticator advertises'),
});
export type PublicKeyCredentialDescriptor = z.infer<typeof PublicKeyCredentialDescriptor>;

/**
 * The transport used by the authenticator
 * generated from [FidoAuthenticatorTransport](../../../../data/contracts/authentication/authentication.types.ck#L235)
 */
export const FidoAuthenticatorTransport = z.enum(['hybrid', 'ble', 'internal', 'nfc', 'usb']);
export type FidoAuthenticatorTransport = z.infer<typeof FidoAuthenticatorTransport>;

/**
 * Response from `/auth/login/oidc/start` instructing the client to navigate to `authorize_url`
 * generated from [OidcLoginStartResponse](../../../../data/contracts/authentication/authentication.types.ck#L260)
 */
export const OidcLoginStartResponse = z.strictObject({
    authorize_url: z.string().describe('Fully-formed authorize URL the user-agent should be redirected to'),
    state: z.string().max(200).describe('Opaque state token bound to this authorization round-trip'),
    expires_at: _ZodDatetime.describe('When the cached state record expires'),
});
export type OidcLoginStartResponse = z.infer<typeof OidcLoginStartResponse>;

/**
 * Request to complete an OIDC sign-in flow
 * generated from [OidcLoginCallback](../../../../data/contracts/authentication/authentication.types.ck#L266)
 */
export const OidcLoginCallback = z.strictObject({
    iss: z.string().optional().describe('The issuer of the token'),
    scope: z.string().optional().describe('The scope of the token'),
    authuser: z.string().optional().describe('The user ID'),
    hd: z.string().optional().describe('The host domain'),
    prompt: z.string().optional().describe('The prompt of the token'),
    code: z.string().max(4096).optional().describe('The authorization code returned by the IdP (absent when the IdP rejected the request)'),
    state: z.string().max(200).optional().describe('The opaque state token bound to the original authorize request'),
    error: z.string().max(200).optional().describe('OAuth 2.0 error code per RFC 6749 §4.1.2.1 (e.g. access_denied)'),
    error_description: z.string().max(2048).optional().describe('Human-readable explanation of `error`'),
    error_uri: z.string().max(2048).optional().describe('URL to a page describing `error`'),
});
export type OidcLoginCallback = z.infer<typeof OidcLoginCallback>;

/**
 * Issue a phone SMS challenge during a pending MFA round
 * generated from [FactorChallengePhoneStart](../../../../data/contracts/authentication/authentication.types.ck#L279)
 */
export const FactorChallengePhoneStart = z.strictObject({
    method: z.literal('phone').describe('Discriminator'),
    transport: z.literal('sms').describe('Delivery channel — only `sms` is supported in this phase'),
    mfa_challenge_id: z.string().max(100).describe('The MFA challenge to which this factor challenge is bound'),
});
export type FactorChallengePhoneStart = z.infer<typeof FactorChallengePhoneStart>;

/**
 * Issue a WebAuthn assertion challenge during a pending MFA round
 * generated from [FactorChallengeFidoStart](../../../../data/contracts/authentication/authentication.types.ck#L285)
 */
export const FactorChallengeFidoStart = z.strictObject({
    method: z.literal('fido').describe('Discriminator'),
    mfa_challenge_id: z.string().max(100).describe('The MFA challenge to which this factor challenge is bound'),
});
export type FactorChallengeFidoStart = z.infer<typeof FactorChallengeFidoStart>;

/**
 * Issue an email one-time-code challenge during a pending MFA round. Always a code: a magic link cannot complete an MFA round, since the `code` grant that redeems one takes `code(min=6, max=10)` and a link token is 43 characters
 * generated from [FactorChallengeEmailStart](../../../../data/contracts/authentication/authentication.types.ck#L290)
 */
export const FactorChallengeEmailStart = z.strictObject({
    method: z.literal('email').describe('Discriminator'),
    mfa_challenge_id: z.string().max(100).describe('The MFA challenge to which this factor challenge is bound'),
});
export type FactorChallengeEmailStart = z.infer<typeof FactorChallengeEmailStart>;

/**
 * Response for a phone SMS challenge
 * generated from [FactorChallengePhoneStartResponse](../../../../data/contracts/authentication/authentication.types.ck#L297)
 */
export const FactorChallengePhoneStartResponse = z
    .strictObject({
        method: z.literal('phone').describe('Discriminator'),
        transport: z.literal('sms').describe('Echo of the chosen delivery channel'),
        phoneChallengeId: z.string().max(100).describe('The phone-factor challenge id — echo back on the `code` grant as `challenge_id`'),
        expiresAt: _ZodDatetime.describe('When the phone challenge expires'),
    })
    .transform(data => ({
        method: data.method,
        transport: data.transport,
        phone_challenge_id: data.phoneChallengeId,
        expires_at: data.expiresAt,
    }));
export type FactorChallengePhoneStartResponse = z.input<typeof FactorChallengePhoneStartResponse>;
export type FactorChallengePhoneStartResponseOutput = z.output<typeof FactorChallengePhoneStartResponse>;

/**
 * Response for an email one-time-code challenge
 * generated from [FactorChallengeEmailStartResponse](../../../../data/contracts/authentication/authentication.types.ck#L311)
 */
export const FactorChallengeEmailStartResponse = z
    .strictObject({
        method: z.literal('email').describe('Discriminator'),
        emailChallengeId: z.string().max(100).describe('The email-factor challenge id — echo back on the `code` grant as `challenge_id`'),
        expiresAt: _ZodDatetime.describe('When the email challenge expires'),
    })
    .transform(data => ({
        method: data.method,
        email_challenge_id: data.emailChallengeId,
        expires_at: data.expiresAt,
    }));
export type FactorChallengeEmailStartResponse = z.input<typeof FactorChallengeEmailStartResponse>;
export type FactorChallengeEmailStartResponseOutput = z.output<typeof FactorChallengeEmailStartResponse>;

/**
 * A factor satisfied by the session
 * generated from [SessionFactor](../../../../data/contracts/authentication/authentication.types.ck#L325)
 */
export const SessionFactor = z.strictObject({
    method: z.enum(['phone', 'password', 'authenticator', 'email', 'fido', 'oidc']).describe('The verification method'),
    methodId: z.string().max(255).describe('Stable identifier for the specific factor record'),
    kind: z.enum(['knowledge', 'possession', 'biometric']).describe('MFA category for the factor'),
    issuedAt: _ZodDatetime.describe('When this factor entry was first added to the session'),
    authenticatedAt: _ZodDatetime.describe('When the factor was most recently re-verified'),
});
export type SessionFactor = z.infer<typeof SessionFactor>;

export const SessionFactorInput = z.strictObject({
    method: z.enum(['phone', 'password', 'authenticator', 'email', 'fido', 'oidc']).describe('The verification method'),
    methodId: z.string().max(255).describe('Stable identifier for the specific factor record'),
    kind: z.enum(['knowledge', 'possession', 'biometric']).describe('MFA category for the factor'),
});
export type SessionFactorInput = z.infer<typeof SessionFactorInput>;

/**
 * Optional metadata supplied to a revoke action
 * generated from [SessionRevoke](../../../../data/contracts/authentication/authentication.types.ck#L345)
 */
export const SessionRevoke = z.strictObject({
    reason: z.string().max(255).nullable().optional().describe('Free-form reason recorded with the revoke'),
});
export type SessionRevoke = z.infer<typeof SessionRevoke>;

/**
 * A platform-wide role held on `platform:main`. `admin` grants every operation; `listener` grants the reads
 * generated from [PlatformRole](../../../../data/contracts/authentication/authentication.types.ck#L350)
 */
export const PlatformRole = z.enum(['admin', 'listener']);
export type PlatformRole = z.infer<typeof PlatformRole>;

/**
 * A successful authentication record
 * generated from [Login](../../../../data/contracts/authentication/authentication.types.ck#L357)
 */
export const Login = z.strictObject({
    id: z
        .preprocess(val => (typeof val === 'string' && /^-?\d+n?$/.test(val) ? BigInt(val.replace(/n$/, '')) : val), z.bigint())
        .describe('The login event identifier'),
    actorId: z.uuid().describe('The actor that authenticated'),
    factorType: z
        .enum(['phone', 'password', 'authenticator', 'email', 'fido', 'oidc'])
        .describe('The factor that satisfied the primary authentication'),
    factorId: z.uuid().nullable().optional().describe('The specific factor record id, when available'),
    sessionToken: z.string().max(255).nullable().optional().describe('The session minted at this login, when available'),
    mfaSatisfied: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Whether MFA was required and satisfied at login'),
    ip: z.string().max(64).nullable().optional().describe('IP address recorded at login'),
    userAgent: z.string().max(512).nullable().optional().describe('User agent recorded at login'),
    occurredAt: _ZodDatetime.describe('When the login occurred'),
});
export type Login = z.infer<typeof Login>;

export const LoginInput = z.strictObject({});
export type LoginInput = z.infer<typeof LoginInput>;

/**
 * The current user's display preferences, auto-detected by the SPA from the browser (Intl timezone + navigator.language). Omitted fields are left unchanged (absent = never set).
 * generated from [ActorPreferences](../../../../data/contracts/authentication/authentication.types.ck#L369)
 */
export const ActorPreferences = z.strictObject({
    locale: z.string().max(32).optional().describe('RFC 5646 locale, e.g. "en-US"'),
    timezone: z.string().max(64).optional().describe('Olson timezone, e.g. "America/New_York"'),
});
export type ActorPreferences = z.infer<typeof ActorPreferences>;

/**
 * generated from [BaseAuthenticationRequest](../../../../data/contracts/authentication/authentication.types.ck#L26)
 */
export const BaseAuthenticationRequest = z.strictObject({
    grant_type: AuthenticationGrantType.describe('The grant type for the request'),
    scope: z.string().max(100).optional().describe('The scope of the request'),
    client_id: z.uuid().optional().describe("The application's client identifier, if available"),
});
export type BaseAuthenticationRequest = z.infer<typeof BaseAuthenticationRequest>;

/**
 * generated from [BaseAuthenticationLoginStart](../../../../data/contracts/authentication/authentication.types.ck#L162)
 */
export const BaseAuthenticationLoginStart = z.strictObject({
    grant_type: PasswordlessAuthenticationGrantType.describe('The grant type for the request'),
    client_id: z.uuid().optional().describe("The application's client identifier, if available"),
});
export type BaseAuthenticationLoginStart = z.infer<typeof BaseAuthenticationLoginStart>;

/**
 * generated from [BaseAuthenticationLoginStartResponse](../../../../data/contracts/authentication/authentication.types.ck#L197)
 */
export const BaseAuthenticationLoginStartResponse = z.strictObject({
    grant_type: PasswordlessAuthenticationGrantType.describe('The grant type for the response'),
    challengeId: z.string().max(100).describe('The challenge identifier'),
    expiresAt: _ZodDatetime.describe('The challenge expiration timestamp'),
});
export type BaseAuthenticationLoginStartResponse = z.infer<typeof BaseAuthenticationLoginStartResponse>;

/**
 * A factor the SPA may use to satisfy the MFA challenge
 * generated from [MfaChallengeFactor](../../../../data/contracts/authentication/authentication.types.ck#L101)
 */
export const MfaChallengeFactor = z
    .strictObject({
        method: AuthenticationFactorMethod.describe('The factor method'),
        methodId: z
            .string()
            .describe("The id of the enrolled factor (opaque to the SPA, must be echoed back in the proof for methods that don't bind another way)"),
        kind: AuthenticationFactorKind.describe(
            'The factor kind (knowledge, possession, biometric) — the SPA filters against step-up `acceptableKinds`/`excludeKinds` hints',
        ),
        label: z.string().optional().describe('Optional human-readable label (e.g. provider name for OIDC, friendly name for FIDO)'),
    })
    .transform(data => ({
        method: data.method,
        method_id: data.methodId,
        kind: data.kind,
        ...(data.label !== undefined ? { label: data.label } : {}),
    }));
export type MfaChallengeFactor = z.input<typeof MfaChallengeFactor>;
export type MfaChallengeFactorOutput = z.output<typeof MfaChallengeFactor>;

/**
 * generated from [AuthenticationFactor](../../../../data/contracts/authentication/authentication.types.ck#L248)
 */
export const AuthenticationFactor = z.strictObject({
    method: AuthenticationFactorMethod.describe('The method of the factor'),
    kind: AuthenticationFactorKind.describe('The kind of the factor'),
    methodId: z.string().describe('The method identifier'),
    label: z.string().optional().describe('The label for the factor'),
});
export type AuthenticationFactor = z.infer<typeof AuthenticationFactor>;

/**
 * Mint a fresh MFA challenge for the current session so the SPA can satisfy a `step_up_required` denial. Filters mirror `StepUpRequirement` from `@maroonedsoftware/policies`.
 * generated from [StepUpStartRequest](../../../../data/contracts/authentication/authentication.types.ck#L319)
 */
export const StepUpStartRequest = z.strictObject({
    acceptableMethods: z.array(AuthenticationFactorMethod).optional().describe('If set, only these factor methods are listed as eligible'),
    acceptableKinds: z.array(AuthenticationFactorKind).optional().describe('If set, only these factor kinds are listed as eligible'),
    excludeMethods: z.array(AuthenticationFactorMethod).optional().describe('If set, factors with these methods are never listed'),
});
export type StepUpStartRequest = z.infer<typeof StepUpStartRequest>;

/**
 * Request to begin an OIDC sign-in flow
 * generated from [OidcLoginStart](../../../../data/contracts/authentication/authentication.types.ck#L255)
 */
export const OidcLoginStart = z.strictObject({
    provider: OidcProvider.describe('The IdP to authorize against'),
    redirect_after: z.string().max(2048).optional().describe('Optional URL the SPA wants the callback to land on after token issuance'),
});
export type OidcLoginStart = z.infer<typeof OidcLoginStart>;

/**
 * generated from [PublicKeyCredentialWithAssertion](../../../../data/contracts/authentication/authentication.types.ck#L145)
 */
export const PublicKeyCredentialWithAssertion = PublicKeyCredential.extend({
    clientExtensionResults: SimpleClientExtensionResults.describe('The client extension results'),
    response: FidoAuthenticatorAssertionResponse.describe('The authenticator assertion response'),
});
export type PublicKeyCredentialWithAssertion = z.infer<typeof PublicKeyCredentialWithAssertion>;

/**
 * generated from [FidoPublicKeyCredentialRequestOptions](../../../../data/contracts/authentication/authentication.types.ck#L211)
 */
export const FidoPublicKeyCredentialRequestOptions = z.strictObject({
    challenge: z.string(),
    timeout: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int())
        .optional()
        .describe('WebAuthn timeout hint in milliseconds'),
    rpId: z.string().optional(),
    attestation: z.enum(['direct', 'indirect', 'none']).optional().describe('The attestation'),
    userVerification: z.enum(['required', 'preferred', 'discouraged']).optional().describe('Whether the authenticator must verify the user'),
    rawChallenge: _ZodBinary.optional().describe('The raw challenge'),
    extensions: z.record(z.string(), z.unknown()).optional(),
    allowCredentials: z.array(PublicKeyCredentialDescriptor).optional(),
});
export type FidoPublicKeyCredentialRequestOptions = z.infer<typeof FidoPublicKeyCredentialRequestOptions>;

/**
 * Serialized form of `AuthenticatorAttestationResponse` — produced by the browser at registration; all binary fields are base64-encoded for transport
 * generated from [FidoAuthenticatorAttestationResponse](../../../../data/contracts/authentication/authentication.types.ck#L237)
 */
export const FidoAuthenticatorAttestationResponse = z.strictObject({
    clientDataJSON: z.string().describe('The client data JSON'),
    attestationObject: z.string().describe('The attestation object'),
    transports: z.array(FidoAuthenticatorTransport).optional().describe('The transports used by the authenticator'),
});
export type FidoAuthenticatorAttestationResponse = z.infer<typeof FidoAuthenticatorAttestationResponse>;

/**
 * generated from [FactorChallengeStartRequest](../../../../data/contracts/authentication/authentication.types.ck#L295)
 */
export const FactorChallengeStartRequest = z.discriminatedUnion('method', [
    FactorChallengePhoneStart,
    FactorChallengeFidoStart,
    FactorChallengeEmailStart,
]);
export type FactorChallengeStartRequest = z.infer<typeof FactorChallengeStartRequest>;

/**
 * An active authentication session
 * generated from [Session](../../../../data/contracts/authentication/authentication.types.ck#L333)
 */
export const Session = z.strictObject({
    sessionToken: z.string().max(255).describe('Opaque session token used as the cache key and embedded in JWTs'),
    actorId: z.uuid().describe('The actor that owns this session'),
    issuedAt: _ZodDatetime.describe('When the session was originally issued'),
    expiresAt: _ZodDatetime.describe('When the session expires'),
    lastAccessedAt: _ZodDatetime.describe('When the session was last accessed'),
    factors: z.array(SessionFactor).describe('Factors that have been satisfied in this session'),
    ip: z.string().max(64).nullable().optional().describe('IP address recorded when the session was created'),
    userAgent: z.string().max(512).nullable().optional().describe('User agent recorded when the session was created'),
    isCurrent: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('True when this session matches the requesting session'),
});
export type Session = z.infer<typeof Session>;

export const SessionInput = z.strictObject({});
export type SessionInput = z.infer<typeof SessionInput>;

/**
 * Who the caller is, as the station sees them
 * generated from [AuthSession](../../../../data/contracts/authentication/authentication.types.ck#L352)
 */
export const AuthSession = z.strictObject({
    actorId: z.string().max(100).describe('The actor the session belongs to'),
    roles: z
        .array(PlatformRole)
        .describe(
            'Every platform role the caller holds, sorted. Empty for an account nobody has granted one, which today is any account that did not come in through onboarding',
        ),
});
export type AuthSession = z.infer<typeof AuthSession>;

/**
 * Represents an application authentication request
 * generated from [ClientCredentialsAuthenticationRequest](../../../../data/contracts/authentication/authentication.types.ck#L32)
 */
export const ClientCredentialsAuthenticationRequest = BaseAuthenticationRequest.extend({
    grant_type: z.literal('client_credentials').describe('The grant type for the request'),
    client_id: z.uuid().describe('The client identifier'),
    client_secret: z.string().min(8).max(256).describe('The client secret'),
});
export type ClientCredentialsAuthenticationRequest = z.infer<typeof ClientCredentialsAuthenticationRequest>;

/**
 * Represents an authentication password request
 * generated from [PasswordAuthenticationRequest](../../../../data/contracts/authentication/authentication.types.ck#L38)
 */
export const PasswordAuthenticationRequest = BaseAuthenticationRequest.extend({
    grant_type: z.literal('password').describe('The grant type for the request'),
    username: z.string().min(3).max(64).describe("User's identifier, usually an email address"),
    password: z.string().min(8).max(256).describe("User's password"),
});
export type PasswordAuthenticationRequest = z.infer<typeof PasswordAuthenticationRequest>;

/**
 * Represents an authentication refresh request
 * generated from [RefreshTokenAuthenticationRequest](../../../../data/contracts/authentication/authentication.types.ck#L44)
 */
export const RefreshTokenAuthenticationRequest = BaseAuthenticationRequest.extend({
    grant_type: z.literal('refresh_token').describe('The grant type for the request'),
    refresh_token: z
        .string()
        .optional()
        .describe(
            'The refresh token issued by the authorization server. Optional: browser clients omit it and present the httpOnly refresh cookie instead',
        ),
});
export type RefreshTokenAuthenticationRequest = z.infer<typeof RefreshTokenAuthenticationRequest>;

/**
 * Represents an authentication magic link request
 * generated from [LinkAuthenticationRequest](../../../../data/contracts/authentication/authentication.types.ck#L49)
 */
export const LinkAuthenticationRequest = BaseAuthenticationRequest.extend({
    grant_type: z.literal('link').describe('The grant type for the request'),
    challenge_id: z
        .string()
        .max(100)
        .describe('The email challenge id returned by `POST /auth/login/start` — binds the link to the issued challenge so cross-device clicks work'),
    link: z.string().describe('The magic link token'),
});
export type LinkAuthenticationRequest = z.infer<typeof LinkAuthenticationRequest>;

/**
 * Represents an authentication one-time-code request
 * generated from [CodeAuthenticationRequest](../../../../data/contracts/authentication/authentication.types.ck#L55)
 */
export const CodeAuthenticationRequest = BaseAuthenticationRequest.extend({
    grant_type: z.literal('code').describe('The grant type for the request'),
    code: z.string().min(6).max(10).describe('The one-time code'),
    code_verifier: z
        .string()
        .min(43)
        .max(128)
        .optional()
        .describe('PKCE verifier — required for a primary code login; absent when mfa_challenge_id is set'),
    mfa_challenge_id: z
        .string()
        .max(100)
        .optional()
        .describe('When set, completes a pending MFA challenge; replaces code_verifier as proof-of-origin'),
    challenge_id: z
        .string()
        .max(100)
        .optional()
        .describe(
            'The phone/email challenge id (returned by POST /auth/factors/start for phone-MFA). Required when mfa_challenge_id is set; ignored otherwise (resolved via PKCE)',
        ),
});
export type CodeAuthenticationRequest = z.infer<typeof CodeAuthenticationRequest>;

/**
 * Submit a TOTP code as a second factor against a pending MFA challenge
 * generated from [AuthenticatorAuthenticationRequest](../../../../data/contracts/authentication/authentication.types.ck#L70)
 */
export const AuthenticatorAuthenticationRequest = BaseAuthenticationRequest.extend({
    grant_type: z.literal('authenticator').describe('The grant type for the request'),
    code: z.string().min(6).max(10).describe('The TOTP code'),
    mfa_challenge_id: z.string().max(100).describe('The pending MFA challenge — required, TOTP has no other actor binding at initial login'),
    method_id: z
        .string()
        .describe("The id of the enrolled authenticator factor to verify against (must be present in the MFA challenge's eligible list)"),
});
export type AuthenticatorAuthenticationRequest = z.infer<typeof AuthenticatorAuthenticationRequest>;

/**
 * Redeem a completed OIDC authorization that the callback stashed under a one-time id
 * generated from [OidcAuthenticationRequest](../../../../data/contracts/authentication/authentication.types.ck#L77)
 */
export const OidcAuthenticationRequest = BaseAuthenticationRequest.extend({
    grant_type: z.literal('oidc').describe('The grant type for the request'),
    challenge_id: z
        .string()
        .max(100)
        .describe(
            'The one-time stash id from the OIDC callback redirect (the value after `?token=oidc:` on `/auth/callback`). Single-use — the API consumes it via `OidcFactorService.redeemAuthenticatedExchange`.',
        ),
});
export type OidcAuthenticationRequest = z.infer<typeof OidcAuthenticationRequest>;

/**
 * generated from [BaseAuthenticationLoginStartWithEmail](../../../../data/contracts/authentication/authentication.types.ck#L167)
 */
export const BaseAuthenticationLoginStartWithEmail = BaseAuthenticationLoginStart.extend({
    email: z.email().describe("User's email address"),
});
export type BaseAuthenticationLoginStartWithEmail = z.infer<typeof BaseAuthenticationLoginStartWithEmail>;

/**
 * Request to begin an OIDC sign-in flow
 * generated from [OidcAuthenticationLoginStart](../../../../data/contracts/authentication/authentication.types.ck#L184)
 */
export const OidcAuthenticationLoginStart = BaseAuthenticationLoginStart.extend({
    grant_type: z.literal('oidc').describe('The grant type for the request'),
    provider: OidcProvider.describe('The IdP to authorize against'),
});
export type OidcAuthenticationLoginStart = z.infer<typeof OidcAuthenticationLoginStart>;

/**
 * generated from [CodeAuthenticationLoginStartResponse](../../../../data/contracts/authentication/authentication.types.ck#L203)
 */
export const CodeAuthenticationLoginStartResponse = BaseAuthenticationLoginStartResponse.extend({
    grant_type: z.literal('code').describe('The grant type for the response'),
});
export type CodeAuthenticationLoginStartResponse = z.infer<typeof CodeAuthenticationLoginStartResponse>;

/**
 * generated from [LinkAuthenticationLoginStartResponse](../../../../data/contracts/authentication/authentication.types.ck#L207)
 */
export const LinkAuthenticationLoginStartResponse = BaseAuthenticationLoginStartResponse.extend({
    grant_type: z.literal('link').describe('The grant type for the response'),
});
export type LinkAuthenticationLoginStartResponse = z.infer<typeof LinkAuthenticationLoginStartResponse>;

/**
 * Response from `/auth/login/oidc/start` instructing the client to navigate to `authorize_url`
 * generated from [OidcAuthenticationLoginStartResponse](../../../../data/contracts/authentication/authentication.types.ck#L227)
 */
export const OidcAuthenticationLoginStartResponse = BaseAuthenticationLoginStartResponse.extend({
    grant_type: z.literal('oidc').describe('The grant type for the response'),
    authorize_url: z.string().describe('Fully-formed authorize URL the user-agent should be redirected to'),
    state: z.string().max(200).describe('Opaque state token bound to this authorization round-trip'),
});
export type OidcAuthenticationLoginStartResponse = z.infer<typeof OidcAuthenticationLoginStartResponse>;

/**
 * MFA-required arm of /auth/token response
 * generated from [MfaRequiredResponse](../../../../data/contracts/authentication/authentication.types.ck#L108)
 */
export const MfaRequiredResponse = z
    .strictObject({
        result: z.literal('mfa_required').describe('Discriminator'),
        challengeId: z.string().max(100).describe('The MFA challenge identifier — pass back as `mfa_challenge_id` on the proof grant'),
        expiresAt: _ZodDatetime.describe('When the MFA challenge expires'),
        factors: z.array(MfaChallengeFactor).describe('Eligible factors the SPA may use to complete the challenge'),
    })
    .transform(data => ({
        result: data.result,
        challenge_id: data.challengeId,
        expires_at: data.expiresAt,
        factors: data.factors,
    }));
export type MfaRequiredResponse = z.input<typeof MfaRequiredResponse>;
export type MfaRequiredResponseOutput = z.output<typeof MfaRequiredResponse>;

/**
 * Represents an authentication passkey request
 * generated from [FidoAuthenticationRequest](../../../../data/contracts/authentication/authentication.types.ck#L63)
 */
export const FidoAuthenticationRequest = BaseAuthenticationRequest.extend({
    grant_type: z.literal('fido').describe('The grant type for the request'),
    credential: PublicKeyCredentialWithAssertion.describe('A passkey credential object'),
    challenge_id: z
        .string()
        .max(100)
        .describe(
            'The FIDO assertion challenge id returned by `POST /auth/login/start` (primary) or `POST /auth/factors/start` (MFA second factor). Must be the per-challenge id, not the actor id.',
        ),
    mfa_challenge_id: z
        .string()
        .max(100)
        .optional()
        .describe('When set, completes a pending MFA challenge instead of issuing a single-factor session'),
});
export type FidoAuthenticationRequest = z.infer<typeof FidoAuthenticationRequest>;

/**
 * WebAuthn assertion options for `navigator.credentials.get`
 * generated from [FidoAuthenticationLoginStartResponse](../../../../data/contracts/authentication/authentication.types.ck#L222)
 */
export const FidoAuthenticationLoginStartResponse = BaseAuthenticationLoginStartResponse.extend({
    grant_type: z.literal('fido').describe('The grant type for the response'),
    assertion: FidoPublicKeyCredentialRequestOptions.describe('The WebAuthn assertion options'),
});
export type FidoAuthenticationLoginStartResponse = z.infer<typeof FidoAuthenticationLoginStartResponse>;

/**
 * Response for a FIDO assertion challenge
 * generated from [FactorChallengeFidoStartResponse](../../../../data/contracts/authentication/authentication.types.ck#L304)
 */
export const FactorChallengeFidoStartResponse = z
    .strictObject({
        method: z.literal('fido').describe('Discriminator'),
        fidoChallengeId: z.string().max(100).describe('The FIDO-factor challenge id — echo back on the `fido` grant as `challenge_id`'),
        assertion: FidoPublicKeyCredentialRequestOptions.describe('WebAuthn assertion options for navigator.credentials.get'),
        expiresAt: _ZodDatetime.describe('When the FIDO challenge expires'),
    })
    .transform(data => ({
        method: data.method,
        fido_challenge_id: data.fidoChallengeId,
        assertion: data.assertion,
        expires_at: data.expiresAt,
    }));
export type FactorChallengeFidoStartResponse = z.input<typeof FactorChallengeFidoStartResponse>;
export type FactorChallengeFidoStartResponseOutput = z.output<typeof FactorChallengeFidoStartResponse>;

/**
 * The credential the client posts back to complete registration
 * generated from [PublicKeyCredentialWithAttestation](../../../../data/contracts/authentication/authentication.types.ck#L243)
 */
export const PublicKeyCredentialWithAttestation = PublicKeyCredential.extend({
    clientExtensionResults: SimpleClientExtensionResults.describe('The client extension results'),
    response: FidoAuthenticatorAttestationResponse.describe('The authenticator attestation response'),
});
export type PublicKeyCredentialWithAttestation = z.infer<typeof PublicKeyCredentialWithAttestation>;

/**
 * generated from [LinkAuthenticationLoginStart](../../../../data/contracts/authentication/authentication.types.ck#L171)
 */
export const LinkAuthenticationLoginStart = BaseAuthenticationLoginStartWithEmail.extend({
    grant_type: z.literal('link').describe('The grant type for the request'),
});
export type LinkAuthenticationLoginStart = z.infer<typeof LinkAuthenticationLoginStart>;

/**
 * generated from [CodeAuthenticationLoginStart](../../../../data/contracts/authentication/authentication.types.ck#L175)
 */
export const CodeAuthenticationLoginStart = BaseAuthenticationLoginStartWithEmail.extend({
    grant_type: z.literal('code').describe('The grant type for the request'),
    code_challenge: z
        .string()
        .max(100)
        .describe('A base64url encoded SHA256 hash of a one time secret used to validate that the request starts and ends on the same device'),
});
export type CodeAuthenticationLoginStart = z.infer<typeof CodeAuthenticationLoginStart>;

/**
 * generated from [FidoAuthenticationLoginStart](../../../../data/contracts/authentication/authentication.types.ck#L180)
 */
export const FidoAuthenticationLoginStart = BaseAuthenticationLoginStartWithEmail.extend({
    grant_type: z.literal('fido').describe('The grant type for the request'),
});
export type FidoAuthenticationLoginStart = z.infer<typeof FidoAuthenticationLoginStart>;

/**
 * generated from [StepUpStartResponse](../../../../data/contracts/authentication/authentication.types.ck#L119)
 */
export const StepUpStartResponse = z.discriminatedUnion('result', [MfaRequiredResponse, EnrollmentRequiredResponse]);
export type StepUpStartResponse = z.infer<typeof StepUpStartResponse>;
export type StepUpStartResponseOutput = z.output<typeof StepUpStartResponse>;

/**
 * generated from [AuthenticationTokenResponse](../../../../data/contracts/authentication/authentication.types.ck#L121)
 */
export const AuthenticationTokenResponse = z.discriminatedUnion('result', [AuthenticationTokenIssued, MfaRequiredResponse]);
export type AuthenticationTokenResponse = z.infer<typeof AuthenticationTokenResponse>;
export type AuthenticationTokenResponseOutput = z.output<typeof AuthenticationTokenResponse>;

/**
 * generated from [AuthenticationRequest](../../../../data/contracts/authentication/authentication.types.ck#L82)
 */
export const AuthenticationRequest = z.discriminatedUnion('grant_type', [
    PasswordAuthenticationRequest,
    ClientCredentialsAuthenticationRequest,
    RefreshTokenAuthenticationRequest,
    LinkAuthenticationRequest,
    CodeAuthenticationRequest,
    FidoAuthenticationRequest,
    AuthenticatorAuthenticationRequest,
    OidcAuthenticationRequest,
]);
export type AuthenticationRequest = z.infer<typeof AuthenticationRequest>;

/**
 * generated from [AuthenticationLoginStartResponse](../../../../data/contracts/authentication/authentication.types.ck#L233)
 */
export const AuthenticationLoginStartResponse = z.discriminatedUnion('grant_type', [
    CodeAuthenticationLoginStartResponse,
    LinkAuthenticationLoginStartResponse,
    FidoAuthenticationLoginStartResponse,
    OidcAuthenticationLoginStartResponse,
]);
export type AuthenticationLoginStartResponse = z.infer<typeof AuthenticationLoginStartResponse>;

/**
 * generated from [FactorChallengeStartResponse](../../../../data/contracts/authentication/authentication.types.ck#L317)
 */
export const FactorChallengeStartResponse = z.discriminatedUnion('method', [
    FactorChallengePhoneStartResponse,
    FactorChallengeFidoStartResponse,
    FactorChallengeEmailStartResponse,
]);
export type FactorChallengeStartResponse = z.infer<typeof FactorChallengeStartResponse>;
export type FactorChallengeStartResponseOutput = z.output<typeof FactorChallengeStartResponse>;

/**
 * generated from [AuthenticationLoginStart](../../../../data/contracts/authentication/authentication.types.ck#L189)
 */
export const AuthenticationLoginStart = z.discriminatedUnion('grant_type', [
    LinkAuthenticationLoginStart,
    CodeAuthenticationLoginStart,
    FidoAuthenticationLoginStart,
    OidcAuthenticationLoginStart,
]);
export type AuthenticationLoginStart = z.infer<typeof AuthenticationLoginStart>;
