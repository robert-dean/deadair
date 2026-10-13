import { z } from 'zod';
import { DateTime } from 'luxon';
import { PlatformRole } from '../../authentication/types/authentication.types.js';

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
});
export type InvitationCreate = z.infer<typeof InvitationCreate>;

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
 * The station's invitations, newest first
 * generated from [InvitationList](../../../../data/contracts/users/invitations.types.ck)
 */
export const InvitationList = z.strictObject({
    data: z.array(Invitation),
});
export type InvitationList = z.infer<typeof InvitationList>;
