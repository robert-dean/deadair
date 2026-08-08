import { z } from 'zod';
import { DateTime } from 'luxon';
import { PublicKeyCredentialWithAttestation } from './authentication.types.js';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * generated from [PhoneFactorRegistration](file://./../../../../data/contracts/authentication/registration.types.ck#L7)
 */
export const PhoneFactorRegistration = z.strictObject({
    method: z.literal('phone').describe('The method of the factor'),
    value: z
        .string()
        .regex(/^\+[1-9]\d{1,14}$/)
        .describe('The phone number in E.164 format (e.g. `+12025550123`)'),
    codeChallenge: z
        .string()
        .max(100)
        .describe('A base64url encoded SHA256 hash of a one time secret used to validate that the request starts and ends on the same device'),
});
export type PhoneFactorRegistration = z.infer<typeof PhoneFactorRegistration>;

/**
 * generated from [PasswordFactorRegistration](file://./../../../../data/contracts/authentication/registration.types.ck#L13)
 */
export const PasswordFactorRegistration = z.strictObject({
    method: z.literal('password').describe('The method of the factor'),
    value: z.string().min(8).max(256).describe('The password'),
});
export type PasswordFactorRegistration = z.infer<typeof PasswordFactorRegistration>;

/**
 * generated from [EmailFactorRegistration](file://./../../../../data/contracts/authentication/registration.types.ck#L18)
 */
export const EmailFactorRegistration = z.strictObject({
    method: z.literal('email').describe('The method of the factor'),
    value: z.email().describe('The email address'),
    codeChallenge: z
        .string()
        .max(100)
        .describe('A base64url encoded SHA256 hash of a one time secret used to validate that the request starts and ends on the same device'),
});
export type EmailFactorRegistration = z.infer<typeof EmailFactorRegistration>;

/**
 * generated from [AuthenticatorFactorRegistration](file://./../../../../data/contracts/authentication/registration.types.ck#L24)
 */
export const AuthenticatorFactorRegistration = z.strictObject({
    method: z.literal('authenticator').describe('The method of the factor'),
    codeChallenge: z
        .string()
        .max(100)
        .describe('A base64url encoded SHA256 hash of a one time secret used to validate that the request starts and ends on the same device'),
    label: z.string().optional().describe('The label for the authenticator factor'),
});
export type AuthenticatorFactorRegistration = z.infer<typeof AuthenticatorFactorRegistration>;

/**
 * generated from [FidoFactorRegistration](file://./../../../../data/contracts/authentication/registration.types.ck#L30)
 */
export const FidoFactorRegistration = z.strictObject({
    method: z.literal('fido').describe('The method of the factor'),
    label: z.string().optional().describe('The label for the FIDO factor'),
});
export type FidoFactorRegistration = z.infer<typeof FidoFactorRegistration>;

/**
 * generated from [PhoneFactorRegistrationResponse](file://./../../../../data/contracts/authentication/registration.types.ck#L37)
 */
export const PhoneFactorRegistrationResponse = z.strictObject({
    method: z.literal('phone').describe('The method of the factor'),
    registrationId: z.string().describe('The registration identifier'),
    expiresAt: _ZodDatetime.describe('The expiration timestamp'),
    issuedAt: _ZodDatetime.describe('The issuance timestamp'),
});
export type PhoneFactorRegistrationResponse = z.infer<typeof PhoneFactorRegistrationResponse>;

/**
 * generated from [PasswordFactorRegistrationResponse](file://./../../../../data/contracts/authentication/registration.types.ck#L44)
 */
export const PasswordFactorRegistrationResponse = z.strictObject({
    method: z.literal('password').describe('The method of the factor'),
    needsReset: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).describe('Whether the password needs to be reset'),
});
export type PasswordFactorRegistrationResponse = z.infer<typeof PasswordFactorRegistrationResponse>;

/**
 * generated from [EmailFactorRegistrationResponse](file://./../../../../data/contracts/authentication/registration.types.ck#L49)
 */
export const EmailFactorRegistrationResponse = z.strictObject({
    method: z.literal('email').describe('The method of the factor'),
    registrationId: z.string().describe('The registration identifier'),
    expiresAt: _ZodDatetime.describe('The expiration timestamp'),
    issuedAt: _ZodDatetime.describe('The issuance timestamp'),
});
export type EmailFactorRegistrationResponse = z.infer<typeof EmailFactorRegistrationResponse>;

/**
 * generated from [AuthenticatorFactorRegistrationResponse](file://./../../../../data/contracts/authentication/registration.types.ck#L56)
 */
export const AuthenticatorFactorRegistrationResponse = z.strictObject({
    method: z.literal('authenticator').describe('The method of the factor'),
    registrationId: z.string().describe('The registration identifier'),
    secret: z.string().describe('The secret for the authenticator'),
    uri: z.string().describe('The URI for the authenticator'),
    qrCode: z.string().describe('The QR code for the authenticator'),
    expiresAt: _ZodDatetime.describe('The expiration timestamp'),
    issuedAt: _ZodDatetime.describe('The issuance timestamp'),
});
export type AuthenticatorFactorRegistrationResponse = z.infer<typeof AuthenticatorFactorRegistrationResponse>;

/**
 * The FIDO factor attestation information
 * generated from [FidoFactorAttestation](file://./../../../../data/contracts/authentication/registration.types.ck#L66)
 */
export const FidoFactorAttestation = z.strictObject({
    rp: z.strictObject({
        name: z.string().describe('The relying party name'),
        id: z.string().describe('The relying party identifier'),
        icon: z.string().optional().describe('The relying party icon'),
    }),
    user: z.strictObject({
        id: z.string().describe('The user identifier'),
        name: z.string().describe('The user name'),
        displayName: z.string().describe('The user display name'),
    }),
    challenge: z.string().describe('The challenge'),
    pubKeyCredParams: z
        .array(
            z.strictObject({
                type: z.literal('public-key'),
                alg: z.coerce.number().int(),
            }),
        )
        .describe('The public key credential parameters'),
    timeout: z.coerce.number().int().optional().describe('The timeout'),
    attestation: z.enum(['direct', 'indirect', 'none']).describe('The attestation'),
});
export type FidoFactorAttestation = z.infer<typeof FidoFactorAttestation>;

/**
 * generated from [PhoneFactorRegistrationVerification](file://./../../../../data/contracts/authentication/registration.types.ck#L93)
 */
export const PhoneFactorRegistrationVerification = z.strictObject({
    method: z.literal('phone').describe('The method of the factor'),
    registrationId: z.string().describe('The registration identifier'),
    code: z.string().min(6).max(10).describe('The verification code'),
    codeVerifier: z
        .string()
        .min(43)
        .max(128)
        .describe('A base64url encoded one time secret used to validate that the request starts and ends on the same device'),
});
export type PhoneFactorRegistrationVerification = z.infer<typeof PhoneFactorRegistrationVerification>;

/**
 * generated from [EmailFactorRegistrationVerification](file://./../../../../data/contracts/authentication/registration.types.ck#L100)
 */
export const EmailFactorRegistrationVerification = z.strictObject({
    method: z.literal('email').describe('The method of the factor'),
    registrationId: z.string().describe('The registration identifier'),
    code: z.string().min(6).max(10).describe('The verification code'),
    codeVerifier: z
        .string()
        .min(43)
        .max(128)
        .describe('A base64url encoded one time secret used to validate that the request starts and ends on the same device'),
});
export type EmailFactorRegistrationVerification = z.infer<typeof EmailFactorRegistrationVerification>;

/**
 * generated from [AuthenticatorFactorRegistrationVerification](file://./../../../../data/contracts/authentication/registration.types.ck#L107)
 */
export const AuthenticatorFactorRegistrationVerification = z.strictObject({
    method: z.literal('authenticator').describe('The method of the factor'),
    registrationId: z.string().describe('The registration identifier'),
    code: z.string().min(6).max(10).describe('The verification code'),
    codeVerifier: z
        .string()
        .min(43)
        .max(128)
        .describe('A base64url encoded one time secret used to validate that the request starts and ends on the same device'),
});
export type AuthenticatorFactorRegistrationVerification = z.infer<typeof AuthenticatorFactorRegistrationVerification>;

/**
 * generated from [FidoFactorRegistrationVerification](file://./../../../../data/contracts/authentication/registration.types.ck#L114)
 */
export const FidoFactorRegistrationVerification = z.strictObject({
    method: z.literal('fido').describe('The method of the factor'),
    registrationId: z.string().describe('The registration identifier'),
    credential: PublicKeyCredentialWithAttestation.describe('The credential the client posts back to complete registration'),
});
export type FidoFactorRegistrationVerification = z.infer<typeof FidoFactorRegistrationVerification>;

/**
 * Begin enrolling a TOTP authenticator during a pending login MFA challenge (no session — authorized by the challenge)
 * generated from [MfaEnrollAuthenticatorStart](file://./../../../../data/contracts/authentication/registration.types.ck#L122)
 */
export const MfaEnrollAuthenticatorStart = z.strictObject({
    mfa_challenge_id: z.string().max(100).describe('The pending MFA challenge from the `mfa_required` login response'),
    label: z.string().max(100).optional().describe('Optional label for the new authenticator factor'),
});
export type MfaEnrollAuthenticatorStart = z.infer<typeof MfaEnrollAuthenticatorStart>;

/**
 * Verify the first TOTP code, persist the authenticator, and complete login
 * generated from [MfaEnrollAuthenticatorVerify](file://./../../../../data/contracts/authentication/registration.types.ck#L127)
 */
export const MfaEnrollAuthenticatorVerify = z.strictObject({
    mfa_challenge_id: z.string().max(100).describe('The same pending MFA challenge'),
    registrationId: z.string().describe('The registration id returned by the enroll-start response'),
    code: z.string().min(6).max(10).describe("The first TOTP code from the user's authenticator app"),
});
export type MfaEnrollAuthenticatorVerify = z.infer<typeof MfaEnrollAuthenticatorVerify>;

/**
 * A second-factor method a user may enroll
 * generated from [EnrollmentMethod](file://./../../../../data/contracts/authentication/registration.types.ck#L133)
 */
export const EnrollmentMethod = z.enum(['authenticator', 'phone', 'fido']);
export type EnrollmentMethod = z.infer<typeof EnrollmentMethod>;

/**
 * Begin enrolling an SMS phone factor during a pending login MFA challenge (no session — authorized by the challenge)
 * generated from [MfaEnrollPhoneStart](file://./../../../../data/contracts/authentication/registration.types.ck#L139)
 */
export const MfaEnrollPhoneStart = z.strictObject({
    mfa_challenge_id: z.string().max(100).describe('The pending MFA challenge from the `mfa_required` login response'),
    value: z
        .string()
        .regex(/^\+[1-9]\d{1,14}$/)
        .describe('The phone number in E.164 format (e.g. `+12025550123`)'),
});
export type MfaEnrollPhoneStart = z.infer<typeof MfaEnrollPhoneStart>;

/**
 * Acknowledges the phone registration and that an OTP was texted
 * generated from [MfaEnrollPhoneStartResponse](file://./../../../../data/contracts/authentication/registration.types.ck#L144)
 */
export const MfaEnrollPhoneStartResponse = z.strictObject({
    method: z.literal('phone').describe('The method of the factor'),
    registrationId: z.string().describe('The registration id — echo back on the verify call'),
    expiresAt: _ZodDatetime.describe('When the registration expires'),
    issuedAt: _ZodDatetime.describe('When the registration was issued'),
});
export type MfaEnrollPhoneStartResponse = z.infer<typeof MfaEnrollPhoneStartResponse>;

/**
 * Verify the texted OTP, persist the phone factor, and complete login
 * generated from [MfaEnrollPhoneVerify](file://./../../../../data/contracts/authentication/registration.types.ck#L151)
 */
export const MfaEnrollPhoneVerify = z.strictObject({
    mfa_challenge_id: z.string().max(100).describe('The same pending MFA challenge'),
    registrationId: z.string().describe('The registration id returned by the enroll-start response'),
    code: z.string().min(6).max(10).describe('The one-time code texted to the phone'),
});
export type MfaEnrollPhoneVerify = z.infer<typeof MfaEnrollPhoneVerify>;

/**
 * Begin enrolling a passkey during a pending login MFA challenge (no session — authorized by the challenge)
 * generated from [MfaEnrollFidoStart](file://./../../../../data/contracts/authentication/registration.types.ck#L157)
 */
export const MfaEnrollFidoStart = z.strictObject({
    mfa_challenge_id: z.string().max(100).describe('The pending MFA challenge from the `mfa_required` login response'),
    label: z.string().max(100).optional().describe('Optional label for the new passkey factor'),
});
export type MfaEnrollFidoStart = z.infer<typeof MfaEnrollFidoStart>;

/**
 * Post the new credential back, persist the passkey factor, and complete login
 * generated from [MfaEnrollFidoVerify](file://./../../../../data/contracts/authentication/registration.types.ck#L170)
 */
export const MfaEnrollFidoVerify = z.strictObject({
    mfa_challenge_id: z.string().max(100).describe('The same pending MFA challenge'),
    registrationId: z.string().describe('The registration id returned by the enroll-start response'),
    credential: PublicKeyCredentialWithAttestation.describe('The credential produced by `navigator.credentials.create`'),
});
export type MfaEnrollFidoVerify = z.infer<typeof MfaEnrollFidoVerify>;

/**
 * generated from [AuthenticationFactorRegistration](file://./../../../../data/contracts/authentication/registration.types.ck#L35)
 */
export const AuthenticationFactorRegistration = z.discriminatedUnion('method', [
    PhoneFactorRegistration,
    PasswordFactorRegistration,
    EmailFactorRegistration,
    AuthenticatorFactorRegistration,
    FidoFactorRegistration,
]);
export type AuthenticationFactorRegistration = z.infer<typeof AuthenticationFactorRegistration>;

/**
 * generated from [FidoFactorRegistrationResponse](file://./../../../../data/contracts/authentication/registration.types.ck#L83)
 */
export const FidoFactorRegistrationResponse = z.strictObject({
    method: z.literal('fido').describe('The method of the factor'),
    registrationId: z.string().describe('The registration identifier'),
    expiresAt: _ZodDatetime.describe('The expiration timestamp'),
    issuedAt: _ZodDatetime.describe('The issuance timestamp'),
    attestation: FidoFactorAttestation.describe('The FIDO factor attestation information'),
});
export type FidoFactorRegistrationResponse = z.infer<typeof FidoFactorRegistrationResponse>;

/**
 * WebAuthn attestation options for `navigator.credentials.create`
 * generated from [MfaEnrollFidoStartResponse](file://./../../../../data/contracts/authentication/registration.types.ck#L162)
 */
export const MfaEnrollFidoStartResponse = z.strictObject({
    method: z.literal('fido').describe('The method of the factor'),
    registrationId: z.string().describe('The registration id — echo back on the verify call'),
    expiresAt: _ZodDatetime.describe('When the registration expires'),
    issuedAt: _ZodDatetime.describe('When the registration was issued'),
    attestation: FidoFactorAttestation.describe('The WebAuthn attestation (credential-creation) options'),
});
export type MfaEnrollFidoStartResponse = z.infer<typeof MfaEnrollFidoStartResponse>;

/**
 * generated from [AuthenticationFactorRegistrationVerification](file://./../../../../data/contracts/authentication/registration.types.ck#L120)
 */
export const AuthenticationFactorRegistrationVerification = z.discriminatedUnion('method', [
    PhoneFactorRegistrationVerification,
    EmailFactorRegistrationVerification,
    AuthenticatorFactorRegistrationVerification,
    FidoFactorRegistrationVerification,
]);
export type AuthenticationFactorRegistrationVerification = z.infer<typeof AuthenticationFactorRegistrationVerification>;

/**
 * Which second factors this instance permits enrolling. `phone` is present only when an SMS provider is configured (SMS_DELIVERY != noop); `authenticator` and `fido` are always available.
 * generated from [EnrollmentMethods](file://./../../../../data/contracts/authentication/registration.types.ck#L135)
 */
export const EnrollmentMethods = z.strictObject({
    methods: z.array(EnrollmentMethod).describe('The enrollable factor methods, in suggested display order'),
});
export type EnrollmentMethods = z.infer<typeof EnrollmentMethods>;

/**
 * generated from [AuthenticationFactorRegistrationResponse](file://./../../../../data/contracts/authentication/registration.types.ck#L91)
 */
export const AuthenticationFactorRegistrationResponse = z.discriminatedUnion('method', [
    PhoneFactorRegistrationResponse,
    PasswordFactorRegistrationResponse,
    EmailFactorRegistrationResponse,
    AuthenticatorFactorRegistrationResponse,
    FidoFactorRegistrationResponse,
]);
export type AuthenticationFactorRegistrationResponse = z.infer<typeof AuthenticationFactorRegistrationResponse>;
