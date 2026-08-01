import type { PublicKeyCredentialWithAttestation } from './authentication.types.js';

/**
 * generated from [PhoneFactorRegistration](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L7)
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
 * generated from [PasswordFactorRegistration](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L13)
 */
export interface PasswordFactorRegistration {
    /** The method of the factor */
    method: 'password';
    /** The password */
    value: string;
}

/**
 * generated from [EmailFactorRegistration](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L18)
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
 * generated from [AuthenticatorFactorRegistration](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L24)
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
 * generated from [FidoFactorRegistration](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L30)
 */
export interface FidoFactorRegistration {
    /** The method of the factor */
    method: 'fido';
    /** The label for the FIDO factor */
    label?: string;
}

/**
 * generated from [PhoneFactorRegistrationResponse](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L37)
 */
export interface PhoneFactorRegistrationResponse {
    /** The method of the factor */
    method: 'phone';
    /** The registration identifier */
    registrationId: string;
    /** The expiration timestamp */
    expiresAt: string;
    /** The issuance timestamp */
    issuedAt: string;
}

/**
 * generated from [PasswordFactorRegistrationResponse](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L44)
 */
export interface PasswordFactorRegistrationResponse {
    /** The method of the factor */
    method: 'password';
    /** Whether the password needs to be reset */
    needsReset: boolean;
}

/**
 * generated from [EmailFactorRegistrationResponse](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L49)
 */
export interface EmailFactorRegistrationResponse {
    /** The method of the factor */
    method: 'email';
    /** The registration identifier */
    registrationId: string;
    /** The expiration timestamp */
    expiresAt: string;
    /** The issuance timestamp */
    issuedAt: string;
}

/**
 * generated from [AuthenticatorFactorRegistrationResponse](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L56)
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
    expiresAt: string;
    /** The issuance timestamp */
    issuedAt: string;
}

/**
 * The FIDO factor attestation information
 * generated from [FidoFactorAttestation](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L66)
 */
export interface FidoFactorAttestation {
    /** The FIDO factor attestation information */
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
 * generated from [PhoneFactorRegistrationVerification](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L93)
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
 * generated from [EmailFactorRegistrationVerification](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L100)
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
 * generated from [AuthenticatorFactorRegistrationVerification](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L107)
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
 * generated from [FidoFactorRegistrationVerification](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L114)
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
 * generated from [MfaEnrollAuthenticatorStart](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L122)
 */
export interface MfaEnrollAuthenticatorStart {
    /** The pending MFA challenge from the `mfa_required` login response */
    mfa_challenge_id: string;
    /** Optional label for the new authenticator factor */
    label?: string;
}

/**
 * Verify the first TOTP code, persist the authenticator, and complete login
 * generated from [MfaEnrollAuthenticatorVerify](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L127)
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
 * generated from [EnrollmentMethod](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L133)
 */
export type EnrollmentMethod = 'authenticator' | 'phone' | 'fido';

/**
 * Begin enrolling an SMS phone factor during a pending login MFA challenge (no session — authorized by the challenge)
 * generated from [MfaEnrollPhoneStart](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L139)
 */
export interface MfaEnrollPhoneStart {
    /** The pending MFA challenge from the `mfa_required` login response */
    mfa_challenge_id: string;
    /** The phone number in E.164 format (e.g. `+12025550123`) */
    value: string;
}

/**
 * Acknowledges the phone registration and that an OTP was texted
 * generated from [MfaEnrollPhoneStartResponse](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L144)
 */
export interface MfaEnrollPhoneStartResponse {
    /** The method of the factor */
    method: 'phone';
    /** The registration id — echo back on the verify call */
    registrationId: string;
    /** When the registration expires */
    expiresAt: string;
    /** When the registration was issued */
    issuedAt: string;
}

/**
 * Verify the texted OTP, persist the phone factor, and complete login
 * generated from [MfaEnrollPhoneVerify](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L151)
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
 * generated from [MfaEnrollFidoStart](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L157)
 */
export interface MfaEnrollFidoStart {
    /** The pending MFA challenge from the `mfa_required` login response */
    mfa_challenge_id: string;
    /** Optional label for the new passkey factor */
    label?: string;
}

/**
 * Post the new credential back, persist the passkey factor, and complete login
 * generated from [MfaEnrollFidoVerify](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L170)
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
 * generated from [AuthenticationFactorRegistration](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L35)
 */
export type AuthenticationFactorRegistration =
    PhoneFactorRegistration | PasswordFactorRegistration | EmailFactorRegistration | AuthenticatorFactorRegistration | FidoFactorRegistration;

/**
 * generated from [FidoFactorRegistrationResponse](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L83)
 */
export interface FidoFactorRegistrationResponse {
    /** The method of the factor */
    method: 'fido';
    /** The registration identifier */
    registrationId: string;
    /** The expiration timestamp */
    expiresAt: string;
    /** The issuance timestamp */
    issuedAt: string;
    /** The FIDO factor attestation information */
    attestation: FidoFactorAttestation;
}

/**
 * WebAuthn attestation options for `navigator.credentials.create`
 * generated from [MfaEnrollFidoStartResponse](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L162)
 */
export interface MfaEnrollFidoStartResponse {
    /** The method of the factor */
    method: 'fido';
    /** The registration id — echo back on the verify call */
    registrationId: string;
    /** When the registration expires */
    expiresAt: string;
    /** When the registration was issued */
    issuedAt: string;
    /** The WebAuthn attestation (credential-creation) options */
    attestation: FidoFactorAttestation;
}

/**
 * generated from [AuthenticationFactorRegistrationVerification](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L120)
 */
export type AuthenticationFactorRegistrationVerification =
    | PhoneFactorRegistrationVerification
    | EmailFactorRegistrationVerification
    | AuthenticatorFactorRegistrationVerification
    | FidoFactorRegistrationVerification;

/**
 * Which second factors this instance permits enrolling. `phone` is present only when an SMS provider is configured (SMS_DELIVERY != noop); `authenticator` and `fido` are always available.
 * generated from [EnrollmentMethods](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L135)
 */
export interface EnrollmentMethods {
    /** The enrollable factor methods, in suggested display order */
    methods: EnrollmentMethod[];
}

/**
 * generated from [AuthenticationFactorRegistrationResponse](file://./../../../../../apps/api/data/contracts/authentication/registration.types.ck#L91)
 */
export type AuthenticationFactorRegistrationResponse =
    | PhoneFactorRegistrationResponse
    | PasswordFactorRegistrationResponse
    | EmailFactorRegistrationResponse
    | AuthenticatorFactorRegistrationResponse
    | FidoFactorRegistrationResponse;
