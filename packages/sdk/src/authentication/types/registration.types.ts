import { DateTime } from 'luxon';
import type { OidcProvider } from './authentication.types.js';
import type { PublicKeyCredentialWithAttestation } from './authentication.types.js';

const __dt = (v: unknown, path: string): DateTime => {
    if (typeof v !== 'string') {
        throw new TypeError(`ContractKit: expected an ISO 8601 string at '${path}', received ${typeof v}.`);
    }
    const d = DateTime.fromISO(v);
    if (!d.isValid) throw new TypeError(`ContractKit: '${v}' at '${path}' is not a valid ISO 8601 datetime.`);
    return d;
};

/**
 * generated from [PhoneFactorRegistration](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L7)
 */
export interface PhoneFactorRegistration {
    /** The method of the factor */
    method: 'phone';
    /** The phone number in E.164 format (e.g. `+12025550123`) */
    value: string;
    /** A base64url encoded SHA256 hash of a one time secret used to validate that the request starts and ends on the same device */
    codeChallenge: string;
}

/**
 * generated from [PasswordFactorRegistration](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L13)
 */
export interface PasswordFactorRegistration {
    /** The method of the factor */
    method: 'password';
    /** The password */
    value: string;
}

/**
 * generated from [EmailFactorRegistration](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L18)
 */
export interface EmailFactorRegistration {
    /** The method of the factor */
    method: 'email';
    /** The email address */
    value: string;
    /** A base64url encoded SHA256 hash of a one time secret used to validate that the request starts and ends on the same device */
    codeChallenge: string;
}

/**
 * generated from [AuthenticatorFactorRegistration](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L24)
 */
export interface AuthenticatorFactorRegistration {
    /** The method of the factor */
    method: 'authenticator';
    /** A base64url encoded SHA256 hash of a one time secret used to validate that the request starts and ends on the same device */
    codeChallenge: string;
    /** The label for the authenticator factor */
    label?: string;
}

/**
 * generated from [FidoFactorRegistration](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L30)
 */
export interface FidoFactorRegistration {
    /** The method of the factor */
    method: 'fido';
    /** The label for the FIDO factor */
    label?: string;
}

/**
 * Link an identity provider to the signed-in account. Answered with the provider's address; the browser goes there and comes back to Security
 * generated from [OidcFactorRegistration](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L35)
 */
export interface OidcFactorRegistration {
    /** The method of the factor */
    method: 'oidc';
    /** The provider to link, as `GET /auth/login/oidc/providers` names it */
    provider: OidcProvider;
}

/**
 * generated from [PhoneFactorRegistrationResponse](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L42)
 */
export interface PhoneFactorRegistrationResponse {
    /** The method of the factor */
    method: 'phone';
    /** The registration identifier */
    registrationId: string;
    /** The expiration timestamp */
    expiresAt: DateTime;
    /** The issuance timestamp */
    issuedAt: DateTime;
}

/** Rehydrates every wire-encoded scalar in a PhoneFactorRegistrationResponse into its runtime type. Mutates and returns `raw`. */
export function revivePhoneFactorRegistrationResponse(raw: PhoneFactorRegistrationResponse): PhoneFactorRegistrationResponse {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['expiresAt'] = __dt(__o0['expiresAt'], 'PhoneFactorRegistrationResponse.expiresAt');
    __o0['issuedAt'] = __dt(__o0['issuedAt'], 'PhoneFactorRegistrationResponse.issuedAt');
    return raw;
}

/**
 * generated from [PasswordFactorRegistrationResponse](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L49)
 */
export interface PasswordFactorRegistrationResponse {
    /** The method of the factor */
    method: 'password';
    /** Whether the password needs to be reset */
    needsReset: boolean;
}

/**
 * generated from [EmailFactorRegistrationResponse](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L54)
 */
export interface EmailFactorRegistrationResponse {
    /** The method of the factor */
    method: 'email';
    /** The registration identifier */
    registrationId: string;
    /** The expiration timestamp */
    expiresAt: DateTime;
    /** The issuance timestamp */
    issuedAt: DateTime;
}

/** Rehydrates every wire-encoded scalar in a EmailFactorRegistrationResponse into its runtime type. Mutates and returns `raw`. */
export function reviveEmailFactorRegistrationResponse(raw: EmailFactorRegistrationResponse): EmailFactorRegistrationResponse {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['expiresAt'] = __dt(__o0['expiresAt'], 'EmailFactorRegistrationResponse.expiresAt');
    __o0['issuedAt'] = __dt(__o0['issuedAt'], 'EmailFactorRegistrationResponse.issuedAt');
    return raw;
}

/**
 * generated from [AuthenticatorFactorRegistrationResponse](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L61)
 */
export interface AuthenticatorFactorRegistrationResponse {
    /** The method of the factor */
    method: 'authenticator';
    /** The registration identifier */
    registrationId: string;
    /** The secret for the authenticator */
    secret: string;
    /** The URI for the authenticator */
    uri: string;
    /** The QR code for the authenticator */
    qrCode: string;
    /** The expiration timestamp */
    expiresAt: DateTime;
    /** The issuance timestamp */
    issuedAt: DateTime;
}

/** Rehydrates every wire-encoded scalar in a AuthenticatorFactorRegistrationResponse into its runtime type. Mutates and returns `raw`. */
export function reviveAuthenticatorFactorRegistrationResponse(raw: AuthenticatorFactorRegistrationResponse): AuthenticatorFactorRegistrationResponse {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['expiresAt'] = __dt(__o0['expiresAt'], 'AuthenticatorFactorRegistrationResponse.expiresAt');
    __o0['issuedAt'] = __dt(__o0['issuedAt'], 'AuthenticatorFactorRegistrationResponse.issuedAt');
    return raw;
}

/**
 * The FIDO factor attestation information
 * generated from [FidoFactorAttestation](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L71)
 */
export interface FidoFactorAttestation {
    /** The relying party */
    rp: { name: string; id: string; icon?: string };
    user: { id: string; name: string; displayName: string };
    /** The challenge */
    challenge: string;
    /** The public key credential parameters */
    pubKeyCredParams: { type: 'public-key'; alg: number }[];
    /** The timeout */
    timeout?: number;
    /** The attestation */
    attestation: 'direct' | 'indirect' | 'none';
}

/**
 * generated from [OidcFactorRegistrationResponse](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L96)
 */
export interface OidcFactorRegistrationResponse {
    /** The method of the factor */
    method: 'oidc';
    /** Where to send the browser. The provider sends it back to Security, with `?linked=<provider>` on success */
    authorizeUrl: string;
    /** When the link attempt expires if the provider has not answered */
    expiresAt: DateTime;
}

/** Rehydrates every wire-encoded scalar in a OidcFactorRegistrationResponse into its runtime type. Mutates and returns `raw`. */
export function reviveOidcFactorRegistrationResponse(raw: OidcFactorRegistrationResponse): OidcFactorRegistrationResponse {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['expiresAt'] = __dt(__o0['expiresAt'], 'OidcFactorRegistrationResponse.expiresAt');
    return raw;
}

/**
 * generated from [PhoneFactorRegistrationVerification](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L104)
 */
export interface PhoneFactorRegistrationVerification {
    /** The method of the factor */
    method: 'phone';
    /** The registration identifier */
    registrationId: string;
    /** The verification code */
    code: string;
    /** A base64url encoded one time secret used to validate that the request starts and ends on the same device */
    codeVerifier: string;
}

/**
 * generated from [EmailFactorRegistrationVerification](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L111)
 */
export interface EmailFactorRegistrationVerification {
    /** The method of the factor */
    method: 'email';
    /** The registration identifier */
    registrationId: string;
    /** The verification code */
    code: string;
    /** A base64url encoded one time secret used to validate that the request starts and ends on the same device */
    codeVerifier: string;
}

/**
 * generated from [AuthenticatorFactorRegistrationVerification](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L118)
 */
export interface AuthenticatorFactorRegistrationVerification {
    /** The method of the factor */
    method: 'authenticator';
    /** The registration identifier */
    registrationId: string;
    /** The verification code */
    code: string;
    /** A base64url encoded one time secret used to validate that the request starts and ends on the same device */
    codeVerifier: string;
}

/**
 * generated from [FidoFactorRegistrationVerification](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L125)
 */
export interface FidoFactorRegistrationVerification {
    /** The method of the factor */
    method: 'fido';
    /** The registration identifier */
    registrationId: string;
    /** The credential the client posts back to complete registration */
    credential: PublicKeyCredentialWithAttestation;
}

/**
 * Begin enrolling a TOTP authenticator during a pending login MFA challenge (no session — authorized by the challenge)
 * generated from [MfaEnrollAuthenticatorStart](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L133)
 */
export interface MfaEnrollAuthenticatorStart {
    /** The pending MFA challenge from the `mfa_required` login response */
    mfa_challenge_id: string;
    /** Optional label for the new authenticator factor */
    label?: string;
}

/**
 * Verify the first TOTP code, persist the authenticator, and complete login
 * generated from [MfaEnrollAuthenticatorVerify](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L138)
 */
export interface MfaEnrollAuthenticatorVerify {
    /** The same pending MFA challenge */
    mfa_challenge_id: string;
    /** The registration id returned by the enroll-start response */
    registrationId: string;
    /** The first TOTP code from the user's authenticator app */
    code: string;
}

/**
 * A second-factor method a user may enroll
 * generated from [EnrollmentMethod](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L144)
 */
export type EnrollmentMethod = 'authenticator' | 'phone' | 'fido';

/**
 * Begin enrolling an SMS phone factor during a pending login MFA challenge (no session — authorized by the challenge)
 * generated from [MfaEnrollPhoneStart](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L150)
 */
export interface MfaEnrollPhoneStart {
    /** The pending MFA challenge from the `mfa_required` login response */
    mfa_challenge_id: string;
    /** The phone number in E.164 format (e.g. `+12025550123`) */
    value: string;
}

/**
 * Acknowledges the phone registration and that an OTP was texted
 * generated from [MfaEnrollPhoneStartResponse](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L155)
 */
export interface MfaEnrollPhoneStartResponse {
    /** The method of the factor */
    method: 'phone';
    /** The registration id — echo back on the verify call */
    registrationId: string;
    /** When the registration expires */
    expiresAt: DateTime;
    /** When the registration was issued */
    issuedAt: DateTime;
}

/** Rehydrates every wire-encoded scalar in a MfaEnrollPhoneStartResponse into its runtime type. Mutates and returns `raw`. */
export function reviveMfaEnrollPhoneStartResponse(raw: MfaEnrollPhoneStartResponse): MfaEnrollPhoneStartResponse {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['expiresAt'] = __dt(__o0['expiresAt'], 'MfaEnrollPhoneStartResponse.expiresAt');
    __o0['issuedAt'] = __dt(__o0['issuedAt'], 'MfaEnrollPhoneStartResponse.issuedAt');
    return raw;
}

/**
 * Verify the texted OTP, persist the phone factor, and complete login
 * generated from [MfaEnrollPhoneVerify](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L162)
 */
export interface MfaEnrollPhoneVerify {
    /** The same pending MFA challenge */
    mfa_challenge_id: string;
    /** The registration id returned by the enroll-start response */
    registrationId: string;
    /** The one-time code texted to the phone */
    code: string;
}

/**
 * Begin enrolling a passkey during a pending login MFA challenge (no session — authorized by the challenge)
 * generated from [MfaEnrollFidoStart](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L168)
 */
export interface MfaEnrollFidoStart {
    /** The pending MFA challenge from the `mfa_required` login response */
    mfa_challenge_id: string;
    /** Optional label for the new passkey factor */
    label?: string;
}

/**
 * Post the new credential back, persist the passkey factor, and complete login
 * generated from [MfaEnrollFidoVerify](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L181)
 */
export interface MfaEnrollFidoVerify {
    /** The same pending MFA challenge */
    mfa_challenge_id: string;
    /** The registration id returned by the enroll-start response */
    registrationId: string;
    /** The credential produced by `navigator.credentials.create` */
    credential: PublicKeyCredentialWithAttestation;
}

/**
 * generated from [AuthenticationFactorRegistration](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L40)
 */
export type AuthenticationFactorRegistration =
    | PhoneFactorRegistration
    | PasswordFactorRegistration
    | EmailFactorRegistration
    | AuthenticatorFactorRegistration
    | FidoFactorRegistration
    | OidcFactorRegistration;

/**
 * generated from [FidoFactorRegistrationResponse](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L88)
 */
export interface FidoFactorRegistrationResponse {
    /** The method of the factor */
    method: 'fido';
    /** The registration identifier */
    registrationId: string;
    /** The expiration timestamp */
    expiresAt: DateTime;
    /** The issuance timestamp */
    issuedAt: DateTime;
    /** The FIDO factor attestation information */
    attestation: FidoFactorAttestation;
}

/** Rehydrates every wire-encoded scalar in a FidoFactorRegistrationResponse into its runtime type. Mutates and returns `raw`. */
export function reviveFidoFactorRegistrationResponse(raw: FidoFactorRegistrationResponse): FidoFactorRegistrationResponse {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['expiresAt'] = __dt(__o0['expiresAt'], 'FidoFactorRegistrationResponse.expiresAt');
    __o0['issuedAt'] = __dt(__o0['issuedAt'], 'FidoFactorRegistrationResponse.issuedAt');
    return raw;
}

/**
 * WebAuthn attestation options for `navigator.credentials.create`
 * generated from [MfaEnrollFidoStartResponse](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L173)
 */
export interface MfaEnrollFidoStartResponse {
    /** The method of the factor */
    method: 'fido';
    /** The registration id — echo back on the verify call */
    registrationId: string;
    /** When the registration expires */
    expiresAt: DateTime;
    /** When the registration was issued */
    issuedAt: DateTime;
    /** The WebAuthn attestation (credential-creation) options */
    attestation: FidoFactorAttestation;
}

/** Rehydrates every wire-encoded scalar in a MfaEnrollFidoStartResponse into its runtime type. Mutates and returns `raw`. */
export function reviveMfaEnrollFidoStartResponse(raw: MfaEnrollFidoStartResponse): MfaEnrollFidoStartResponse {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['expiresAt'] = __dt(__o0['expiresAt'], 'MfaEnrollFidoStartResponse.expiresAt');
    __o0['issuedAt'] = __dt(__o0['issuedAt'], 'MfaEnrollFidoStartResponse.issuedAt');
    return raw;
}

/**
 * generated from [AuthenticationFactorRegistrationVerification](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L131)
 */
export type AuthenticationFactorRegistrationVerification =
    | PhoneFactorRegistrationVerification
    | EmailFactorRegistrationVerification
    | AuthenticatorFactorRegistrationVerification
    | FidoFactorRegistrationVerification;

/**
 * Which second factors this instance permits enrolling. `phone` is present only when an SMS provider is configured (SMS_DELIVERY != noop); `authenticator` and `fido` are always available.
 * generated from [EnrollmentMethods](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L146)
 */
export interface EnrollmentMethods {
    /** The enrollable factor methods, in suggested display order */
    methods: EnrollmentMethod[];
}

/**
 * generated from [AuthenticationFactorRegistrationResponse](../../../../../apps/api/data/contracts/authentication/registration.types.ck#L102)
 */
export type AuthenticationFactorRegistrationResponse =
    | PhoneFactorRegistrationResponse
    | PasswordFactorRegistrationResponse
    | EmailFactorRegistrationResponse
    | AuthenticatorFactorRegistrationResponse
    | FidoFactorRegistrationResponse
    | OidcFactorRegistrationResponse;

/** Rehydrates every wire-encoded scalar in a AuthenticationFactorRegistrationResponse into its runtime type. Mutates and returns `raw`. */
export function reviveAuthenticationFactorRegistrationResponse(
    raw: AuthenticationFactorRegistrationResponse,
): AuthenticationFactorRegistrationResponse {
    const __v = [raw] as unknown[];
    {
        const __d0 = (__v[0] as Record<string, unknown>)['method'];
        if (__d0 === 'phone') {
            revivePhoneFactorRegistrationResponse(__v[0] as never);
        }
        if (__d0 === 'email') {
            reviveEmailFactorRegistrationResponse(__v[0] as never);
        }
        if (__d0 === 'authenticator') {
            reviveAuthenticatorFactorRegistrationResponse(__v[0] as never);
        }
        if (__d0 === 'fido') {
            reviveFidoFactorRegistrationResponse(__v[0] as never);
        }
        if (__d0 === 'oidc') {
            reviveOidcFactorRegistrationResponse(__v[0] as never);
        }
    }
    return __v[0] as AuthenticationFactorRegistrationResponse;
}
