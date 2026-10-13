import { z } from 'zod';
import { DateTime } from 'luxon';
import { FidoFactorAttestation } from '../../authentication/types/registration.types.js';
import { PlatformRole } from '../../authentication/types/authentication.types.js';
import { PublicKeyCredentialWithAttestation } from '../../authentication/types/authentication.types.js';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * Where an invitation stands. `expired` is a pending invitation whose time ran out
 * generated from [InvitationState](../../../../data/contracts/users/invitations.types.ck)
 */
export const InvitationState = z.enum(['pending', 'accepted', 'revoked', 'expired']);
export type InvitationState = z.infer<typeof InvitationState>;

/**
 * Invite somebody by their address
 * generated from [InvitationCreate](../../../../data/contracts/users/invitations.types.ck)
 */
export const InvitationCreate = z.strictObject({
    email: z.email().describe('The address the account will have'),
    role: PlatformRole.describe('The role the account will hold'),
    send: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .optional()
        .describe('Email the link to the address too. Refused with a 503, and nothing made, when the station has no mail server'),
});
export type InvitationCreate = z.infer<typeof InvitationCreate>;

/**
 * An invitation's link token, as it appears after `#` on the invite page
 * generated from [InvitationToken](../../../../data/contracts/users/invitations.types.ck)
 */
export const InvitationToken = z.strictObject({
    token: z.string().min(1).max(200).describe('The token'),
});
export type InvitationToken = z.infer<typeof InvitationToken>;

/**
 * What an open invitation is for, shown to the person before they accept
 * generated from [InvitationDetails](../../../../data/contracts/users/invitations.types.ck)
 */
export const InvitationDetails = z.strictObject({
    email: z.string().max(320).describe('The address the account will have'),
    role: PlatformRole.describe('The role it will hold'),
    stationName: z.string().describe('What the station calls itself'),
    expiresAt: _ZodDatetime.describe('When the link stops working'),
});
export type InvitationDetails = z.infer<typeof InvitationDetails>;

/**
 * How the person will prove it is them after their password: an authenticator app, or a passkey
 * generated from [InvitationSecondStep](../../../../data/contracts/users/invitations.types.ck)
 */
export const InvitationSecondStep = z.enum(['authenticator', 'fido']);
export type InvitationSecondStep = z.infer<typeof InvitationSecondStep>;

/**
 * An authenticator app to scan, for an invitation being accepted
 * generated from [InvitationAuthenticatorSetup](../../../../data/contracts/users/invitations.types.ck)
 */
export const InvitationAuthenticatorSetup = z.strictObject({
    method: z.literal('authenticator').describe('Discriminator'),
    registrationId: z.string().describe('Send this back with the first code'),
    secret: z.string().describe('The key, for an app that cannot scan'),
    uri: z.string().describe('The `otpauth://` address the QR code holds'),
    qrCode: z.string().describe('The QR code, as a data URL'),
});
export type InvitationAuthenticatorSetup = z.infer<typeof InvitationAuthenticatorSetup>;

/**
 * A passkey to make, for an invitation being accepted
 * generated from [InvitationPasskeySetup](../../../../data/contracts/users/invitations.types.ck)
 */
export const InvitationPasskeySetup = z.strictObject({
    method: z.literal('fido').describe('Discriminator'),
    registrationId: z.string().describe('Send this back with the credential'),
    attestation: FidoFactorAttestation.describe('What to hand `navigator.credentials.create`'),
});
export type InvitationPasskeySetup = z.infer<typeof InvitationPasskeySetup>;

/**
 * Accept with the first code from the authenticator app
 * generated from [InvitationAcceptWithAuthenticator](../../../../data/contracts/users/invitations.types.ck)
 */
export const InvitationAcceptWithAuthenticator = z.strictObject({
    method: z.literal('authenticator').describe('Discriminator'),
    token: z.string().min(1).max(200).describe("The invitation's token"),
    password: z.string().min(8).max(256).describe('The same password as at the start'),
    registrationId: z.string().describe('From the start'),
    code: z.string().min(6).max(10).describe('The first code the app shows'),
});
export type InvitationAcceptWithAuthenticator = z.infer<typeof InvitationAcceptWithAuthenticator>;

/**
 * Accept with the passkey the browser just made
 * generated from [InvitationAcceptWithPasskey](../../../../data/contracts/users/invitations.types.ck)
 */
export const InvitationAcceptWithPasskey = z.strictObject({
    method: z.literal('fido').describe('Discriminator'),
    token: z.string().min(1).max(200).describe("The invitation's token"),
    password: z.string().min(8).max(256).describe('The same password as at the start'),
    registrationId: z.string().describe('From the start'),
    credential: PublicKeyCredentialWithAttestation.describe('What `navigator.credentials.create` answered'),
});
export type InvitationAcceptWithPasskey = z.infer<typeof InvitationAcceptWithPasskey>;

/**
 * The account made from an invitation. Sign in with it as usual
 * generated from [InvitationAccepted](../../../../data/contracts/users/invitations.types.ck)
 */
export const InvitationAccepted = z.strictObject({
    email: z.string().max(320).describe('The address to sign in with'),
    role: PlatformRole.describe('The role it holds'),
});
export type InvitationAccepted = z.infer<typeof InvitationAccepted>;

/**
 * An invitation for somebody to take an account on the station
 * generated from [Invitation](../../../../data/contracts/users/invitations.types.ck)
 */
export const Invitation = z.strictObject({
    id: z.uuid().describe("The invitation's id"),
    email: z.string().max(320).describe('The address the account will have. The person cannot change it while accepting'),
    role: PlatformRole.describe('The role the account will hold'),
    state: InvitationState.describe('Where it stands'),
    createdAt: _ZodDatetime.describe('When it was made'),
    expiresAt: _ZodDatetime.describe('When the link stops working, if nobody has used it'),
    invitedBy: z.string().max(320).optional().describe('The address of the admin who made it. Absent once their account is gone'),
    acceptedAt: _ZodDatetime.optional().describe('When somebody accepted it'),
    revokedAt: _ZodDatetime.optional().describe('When it was withdrawn, by an admin or by a newer invitation to the same address'),
    token: z
        .string()
        .max(200)
        .optional()
        .describe(
            "The invitation itself, only while it is pending. Put it after `#` on the station's `/invite` page, as `/invite#<token>`. Anyone holding it can claim the account, so show it only to the person invited",
        ),
});
export type Invitation = z.infer<typeof Invitation>;

/**
 * Choose a password and a second step. Nothing is saved yet
 * generated from [InvitationAcceptStart](../../../../data/contracts/users/invitations.types.ck)
 */
export const InvitationAcceptStart = z.strictObject({
    token: z.string().min(1).max(200).describe("The invitation's token"),
    password: z
        .string()
        .min(8)
        .max(256)
        .describe('The password the account will have. Refused here if it is too weak, so the person learns before setting anything else up'),
    method: InvitationSecondStep.describe('The second step to set up'),
});
export type InvitationAcceptStart = z.infer<typeof InvitationAcceptStart>;

/**
 * generated from [InvitationAcceptStartResponse](../../../../data/contracts/users/invitations.types.ck)
 */
export const InvitationAcceptStartResponse = z.discriminatedUnion('method', [InvitationAuthenticatorSetup, InvitationPasskeySetup]);
export type InvitationAcceptStartResponse = z.infer<typeof InvitationAcceptStartResponse>;

/**
 * generated from [InvitationAccept](../../../../data/contracts/users/invitations.types.ck)
 */
export const InvitationAccept = z.discriminatedUnion('method', [InvitationAcceptWithAuthenticator, InvitationAcceptWithPasskey]);
export type InvitationAccept = z.infer<typeof InvitationAccept>;

/**
 * The station's invitations, newest first
 * generated from [InvitationList](../../../../data/contracts/users/invitations.types.ck)
 */
export const InvitationList = z.strictObject({
    data: z.array(Invitation),
});
export type InvitationList = z.infer<typeof InvitationList>;
