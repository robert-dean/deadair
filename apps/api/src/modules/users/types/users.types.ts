import { z } from 'zod';
import { DateTime } from 'luxon';
import { Pagination } from '../../shared/types/pagination.js';
import { PaginationInput } from '../../shared/types/pagination.js';
import { PaginationWithActive } from '../../shared/types/pagination.js';
import { PaginationWithActiveInput } from '../../shared/types/pagination.js';
import { PlatformRole } from '../../authentication/types/authentication.types.js';
import { Session } from '../../authentication/types/authentication.types.js';
import { SessionInput } from '../../authentication/types/authentication.types.js';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * Which people to list
 * generated from [UserQuery](../../../../data/contracts/users/users.types.ck)
 */
export const UserQuery = PaginationWithActive.extend({
    search: z.string().min(1).max(200).optional().describe('Part of an email address'),
    role: PlatformRole.optional().describe('Only people holding this role'),
});
export type UserQuery = z.infer<typeof UserQuery>;

export const UserQueryInput = PaginationWithActiveInput.extend({
    search: z.string().min(1).max(200).optional().describe('Part of an email address'),
    role: PlatformRole.optional().describe('Only people holding this role'),
});
export type UserQueryInput = z.infer<typeof UserQueryInput>;

/**
 * A person with an account on the station
 * generated from [UserSummary](../../../../data/contracts/users/users.types.ck)
 */
export const UserSummary = z.strictObject({
    id: z.uuid().describe("The person's account id"),
    email: z
        .string()
        .max(320)
        .optional()
        .describe('The address they sign in with. Absent for an account that has none, such as one made through a provider that shared no address'),
    role: PlatformRole.optional().describe('The one role they hold. Absent for an account nobody has granted one'),
    active: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('False once the account has been switched off. A switched-off person cannot sign in, and every session they held has ended'),
    createdAt: _ZodDatetime.describe('When the account was made'),
    lastSignInAt: _ZodDatetime.optional().describe('When they last signed in. Absent if they never have'),
    hasStrongFactor: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Whether they have an authenticator app or a passkey, which the phone apps need to sign in with'),
});
export type UserSummary = z.infer<typeof UserSummary>;

/**
 * One way a person signs in. Never the secret itself
 * generated from [UserFactor](../../../../data/contracts/users/users.types.ck)
 */
export const UserFactor = z.strictObject({
    method: z.enum(['email', 'password', 'authenticator', 'fido', 'oidc', 'phone']).describe('What kind of factor it is'),
    methodId: z.string().max(255).describe('Which factor of that kind'),
    kind: z.enum(['knowledge', 'possession', 'biometric']).describe('What it proves'),
    label: z.string().max(255).optional().describe("How it is shown, such as a masked address or the authenticator's name"),
});
export type UserFactor = z.infer<typeof UserFactor>;

/**
 * One time a person signed in
 * generated from [UserSignIn](../../../../data/contracts/users/users.types.ck)
 */
export const UserSignIn = z.strictObject({
    occurredAt: _ZodDatetime.describe('When'),
    method: z.string().max(64).describe('The factor they signed in with'),
    mfaSatisfied: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).describe('Whether a second factor was proved'),
    ip: z.string().max(64).optional().describe('The address the request came from'),
    userAgent: z.string().max(512).optional().describe('The app or browser that asked'),
});
export type UserSignIn = z.infer<typeof UserSignIn>;

/**
 * One page of people
 * generated from [UserPage](../../../../data/contracts/users/users.types.ck)
 */
export const UserPage = z.strictObject({
    meta: Pagination,
    data: z.array(UserSummary),
});
export type UserPage = z.infer<typeof UserPage>;

export const UserPageInput = z.strictObject({
    meta: PaginationInput,
    data: z.array(UserSummary),
});
export type UserPageInput = z.infer<typeof UserPageInput>;

/**
 * A person, with how they sign in and where they are signed in
 * generated from [UserDetail](../../../../data/contracts/users/users.types.ck)
 */
export const UserDetail = UserSummary.extend({
    factors: z.array(UserFactor).describe('Every way they can sign in'),
    sessions: z.array(Session).describe('Where they are signed in now'),
    signIns: z.array(UserSignIn).describe('Their most recent sign-ins, newest first'),
});
export type UserDetail = z.infer<typeof UserDetail>;

export const UserDetailInput = UserSummary.extend({
    factors: z.array(UserFactor).describe('Every way they can sign in'),
    sessions: z.array(SessionInput).describe('Where they are signed in now'),
    signIns: z.array(UserSignIn).describe('Their most recent sign-ins, newest first'),
});
export type UserDetailInput = z.infer<typeof UserDetailInput>;
