import { DateTime } from 'luxon';
import type { Pagination } from '../../shared/types/pagination.js';
import type { PaginationInput } from '../../shared/types/pagination.js';
import type { PaginationWithActive } from '../../shared/types/pagination.js';
import type { PaginationWithActiveInput } from '../../shared/types/pagination.js';
import type { PlatformRole } from '../../authentication/types/authentication.types.js';
import type { Session } from '../../authentication/types/authentication.types.js';
import { reviveSession } from '../../authentication/types/authentication.types.js';
import type { SessionInput } from '../../authentication/types/authentication.types.js';

const __dt = (v: unknown, path: string): DateTime => {
    if (typeof v !== 'string') {
        throw new TypeError(`ContractKit: expected an ISO 8601 string at '${path}', received ${typeof v}.`);
    }
    const d = DateTime.fromISO(v);
    if (!d.isValid) throw new TypeError(`ContractKit: '${v}' at '${path}' is not a valid ISO 8601 datetime.`);
    return d;
};

/**
 * Which people to list
 * generated from [UserQuery](../../../../../apps/api/data/contracts/users/users.types.ck)
 */
export interface UserQuery extends PaginationWithActive {
    /** Part of an email address */
    search?: string;
    /** Only people holding this role */
    role?: PlatformRole;
}

export interface UserQueryInput extends PaginationWithActiveInput {
    /** Part of an email address */
    search?: string;
    /** Only people holding this role */
    role?: PlatformRole;
}

/**
 * A person with an account on the station
 * generated from [UserSummary](../../../../../apps/api/data/contracts/users/users.types.ck)
 */
export interface UserSummary {
    /** The person's account id */
    id: string;
    /** The address they sign in with. Absent for an account that has none, such as one made through a provider that shared no address */
    email?: string;
    /** The one role they hold. Absent for an account nobody has granted one */
    role?: PlatformRole;
    /** False once the account has been switched off. A switched-off person cannot sign in, and every session they held has ended */
    active: boolean;
    /** When the account was made */
    createdAt: DateTime;
    /** When they last signed in. Absent if they never have */
    lastSignInAt?: DateTime;
    /** Whether they have an authenticator app or a passkey, which the phone apps need to sign in with */
    hasStrongFactor: boolean;
}

/** Rehydrates every wire-encoded scalar in a UserSummary into its runtime type. Mutates and returns `raw`. */
export function reviveUserSummary(raw: UserSummary): UserSummary {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['createdAt'] = __dt(__o0['createdAt'], 'UserSummary.createdAt');
    if (__o0['lastSignInAt'] != null) {
        __o0['lastSignInAt'] = __dt(__o0['lastSignInAt'], 'UserSummary.lastSignInAt');
    }
    return raw;
}

/**
 * One way a person signs in. Never the secret itself
 * generated from [UserFactor](../../../../../apps/api/data/contracts/users/users.types.ck)
 */
export interface UserFactor {
    /** What kind of factor it is */
    method: 'email' | 'password' | 'authenticator' | 'fido' | 'oidc' | 'phone';
    /** Which factor of that kind */
    methodId: string;
    /** What it proves */
    kind: 'knowledge' | 'possession' | 'biometric';
    /** How it is shown, such as a masked address or the authenticator's name */
    label?: string;
}

/**
 * One time a person signed in
 * generated from [UserSignIn](../../../../../apps/api/data/contracts/users/users.types.ck)
 */
export interface UserSignIn {
    /** When */
    occurredAt: DateTime;
    /** The factor they signed in with */
    method: string;
    /** Whether a second factor was proved */
    mfaSatisfied: boolean;
    /** The address the request came from */
    ip?: string;
    /** The app or browser that asked */
    userAgent?: string;
}

/** Rehydrates every wire-encoded scalar in a UserSignIn into its runtime type. Mutates and returns `raw`. */
export function reviveUserSignIn(raw: UserSignIn): UserSignIn {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['occurredAt'] = __dt(__o0['occurredAt'], 'UserSignIn.occurredAt');
    return raw;
}

/**
 * The role a person should hold
 * generated from [UserRoleChange](../../../../../apps/api/data/contracts/users/users.types.ck)
 */
export interface UserRoleChange {
    /** Replaces whatever role they held */
    role: PlatformRole;
}

/**
 * One page of people
 * generated from [UserPage](../../../../../apps/api/data/contracts/users/users.types.ck)
 */
export interface UserPage {
    meta: Pagination;
    data: UserSummary[];
}

export interface UserPageInput {
    meta: PaginationInput;
    data: UserSummary[];
}

/** Rehydrates every wire-encoded scalar in a UserPage into its runtime type. Mutates and returns `raw`. */
export function reviveUserPage(raw: UserPage): UserPage {
    const __o0 = raw as unknown as Record<string, unknown>;
    {
        const __a1 = __o0['data'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveUserSummary(__a1[__i2] as never);
        }
    }
    return raw;
}

/**
 * A person, with how they sign in and where they are signed in
 * generated from [UserDetail](../../../../../apps/api/data/contracts/users/users.types.ck)
 */
export interface UserDetail extends UserSummary {
    /** Every way they can sign in */
    factors: UserFactor[];
    /** Where they are signed in now */
    sessions: Session[];
    /** Their most recent sign-ins, newest first */
    signIns: UserSignIn[];
}

export interface UserDetailInput extends UserSummary {
    /** Every way they can sign in */
    factors: UserFactor[];
    /** Where they are signed in now */
    sessions: SessionInput[];
    /** Their most recent sign-ins, newest first */
    signIns: UserSignIn[];
}

/** Rehydrates every wire-encoded scalar in a UserDetail into its runtime type. Mutates and returns `raw`. */
export function reviveUserDetail(raw: UserDetail): UserDetail {
    const __o0 = raw as unknown as Record<string, unknown>;
    reviveUserSummary(raw as never);
    {
        const __a1 = __o0['sessions'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveSession(__a1[__i2] as never);
        }
    }
    {
        const __a3 = __o0['signIns'] as unknown[];
        for (let __i4 = 0; __i4 < __a3.length; __i4++) {
            reviveUserSignIn(__a3[__i4] as never);
        }
    }
    return raw;
}
