import { DateTime } from 'luxon';
import type { FidoFactorAttestation } from '../../authentication/types/registration.types.js';
import type { PlatformRole } from '../../authentication/types/authentication.types.js';
import type { PublicKeyCredentialWithAttestation } from '../../authentication/types/authentication.types.js';

const __dt = (v: unknown, path: string): DateTime => {
    if (typeof v !== 'string') {
        throw new TypeError(`ContractKit: expected an ISO 8601 string at '${path}', received ${typeof v}.`);
    }
    const d = DateTime.fromISO(v);
    if (!d.isValid) throw new TypeError(`ContractKit: '${v}' at '${path}' is not a valid ISO 8601 datetime.`);
    return d;
};

/**
 * Where an invitation stands. `expired` is a pending invitation whose time ran out
 * generated from [InvitationState](../../../../../apps/api/data/contracts/users/invitations.types.ck)
 */
export type InvitationState = 'pending' | 'accepted' | 'revoked' | 'expired';

/**
 * Invite somebody by their address
 * generated from [InvitationCreate](../../../../../apps/api/data/contracts/users/invitations.types.ck)
 */
export interface InvitationCreate {
    /** The address the account will have */
    email: string;
    /** The role the account will hold */
    role: PlatformRole;
}

/**
 * An invitation's link token, as it appears after `#` on the invite page
 * generated from [InvitationToken](../../../../../apps/api/data/contracts/users/invitations.types.ck)
 */
export interface InvitationToken {
    /** The token */
    token: string;
}

/**
 * What an open invitation is for, shown to the person before they accept
 * generated from [InvitationDetails](../../../../../apps/api/data/contracts/users/invitations.types.ck)
 */
export interface InvitationDetails {
    /** The address the account will have */
    email: string;
    /** The role it will hold */
    role: PlatformRole;
    /** What the station calls itself */
    stationName: string;
    /** When the link stops working */
    expiresAt: DateTime;
}

/** Rehydrates every wire-encoded scalar in a InvitationDetails into its runtime type. Mutates and returns `raw`. */
export function reviveInvitationDetails(raw: InvitationDetails): InvitationDetails {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['expiresAt'] = __dt(__o0['expiresAt'], 'InvitationDetails.expiresAt');
    return raw;
}

/**
 * How the person will prove it is them after their password: an authenticator app, or a passkey
 * generated from [InvitationSecondStep](../../../../../apps/api/data/contracts/users/invitations.types.ck)
 */
export type InvitationSecondStep = 'authenticator' | 'fido';

/**
 * An authenticator app to scan, for an invitation being accepted
 * generated from [InvitationAuthenticatorSetup](../../../../../apps/api/data/contracts/users/invitations.types.ck)
 */
export interface InvitationAuthenticatorSetup {
    /** Discriminator */
    method: 'authenticator';
    /** Send this back with the first code */
    registrationId: string;
    /** The key, for an app that cannot scan */
    secret: string;
    /** The `otpauth://` address the QR code holds */
    uri: string;
    /** The QR code, as a data URL */
    qrCode: string;
}

/**
 * A passkey to make, for an invitation being accepted
 * generated from [InvitationPasskeySetup](../../../../../apps/api/data/contracts/users/invitations.types.ck)
 */
export interface InvitationPasskeySetup {
    /** Discriminator */
    method: 'fido';
    /** Send this back with the credential */
    registrationId: string;
    /** What to hand `navigator.credentials.create` */
    attestation: FidoFactorAttestation;
}

/**
 * Accept with the first code from the authenticator app
 * generated from [InvitationAcceptWithAuthenticator](../../../../../apps/api/data/contracts/users/invitations.types.ck)
 */
export interface InvitationAcceptWithAuthenticator {
    /** Discriminator */
    method: 'authenticator';
    /** The invitation's token */
    token: string;
    /** The same password as at the start */
    password: string;
    /** From the start */
    registrationId: string;
    /** The first code the app shows */
    code: string;
}

/**
 * Accept with the passkey the browser just made
 * generated from [InvitationAcceptWithPasskey](../../../../../apps/api/data/contracts/users/invitations.types.ck)
 */
export interface InvitationAcceptWithPasskey {
    /** Discriminator */
    method: 'fido';
    /** The invitation's token */
    token: string;
    /** The same password as at the start */
    password: string;
    /** From the start */
    registrationId: string;
    /** What `navigator.credentials.create` answered */
    credential: PublicKeyCredentialWithAttestation;
}

/**
 * The account made from an invitation. Sign in with it as usual
 * generated from [InvitationAccepted](../../../../../apps/api/data/contracts/users/invitations.types.ck)
 */
export interface InvitationAccepted {
    /** The address to sign in with */
    email: string;
    /** The role it holds */
    role: PlatformRole;
}

/**
 * An invitation for somebody to take an account on the station
 * generated from [Invitation](../../../../../apps/api/data/contracts/users/invitations.types.ck)
 */
export interface Invitation {
    /** The invitation's id */
    id: string;
    /** The address the account will have. The person cannot change it while accepting */
    email: string;
    /** The role the account will hold */
    role: PlatformRole;
    /** Where it stands */
    state: InvitationState;
    /** When it was made */
    createdAt: DateTime;
    /** When the link stops working, if nobody has used it */
    expiresAt: DateTime;
    /** The address of the admin who made it. Absent once their account is gone */
    invitedBy?: string;
    /** When somebody accepted it */
    acceptedAt?: DateTime;
    /** When it was withdrawn, by an admin or by a newer invitation to the same address */
    revokedAt?: DateTime;
    /** The invitation itself, only while it is pending. Put it after `#` on the station's `/invite` page, as `/invite#<token>`. Anyone holding it can claim the account, so show it only to the person invited */
    token?: string;
}

/** Rehydrates every wire-encoded scalar in a Invitation into its runtime type. Mutates and returns `raw`. */
export function reviveInvitation(raw: Invitation): Invitation {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['createdAt'] = __dt(__o0['createdAt'], 'Invitation.createdAt');
    __o0['expiresAt'] = __dt(__o0['expiresAt'], 'Invitation.expiresAt');
    if (__o0['acceptedAt'] != null) {
        __o0['acceptedAt'] = __dt(__o0['acceptedAt'], 'Invitation.acceptedAt');
    }
    if (__o0['revokedAt'] != null) {
        __o0['revokedAt'] = __dt(__o0['revokedAt'], 'Invitation.revokedAt');
    }
    return raw;
}

/**
 * Choose a password and a second step. Nothing is saved yet
 * generated from [InvitationAcceptStart](../../../../../apps/api/data/contracts/users/invitations.types.ck)
 */
export interface InvitationAcceptStart {
    /** The invitation's token */
    token: string;
    /** The password the account will have. Refused here if it is too weak, so the person learns before setting anything else up */
    password: string;
    /** The second step to set up */
    method: InvitationSecondStep;
}

/**
 * generated from [InvitationAcceptStartResponse](../../../../../apps/api/data/contracts/users/invitations.types.ck)
 */
export type InvitationAcceptStartResponse = InvitationAuthenticatorSetup | InvitationPasskeySetup;

/**
 * generated from [InvitationAccept](../../../../../apps/api/data/contracts/users/invitations.types.ck)
 */
export type InvitationAccept = InvitationAcceptWithAuthenticator | InvitationAcceptWithPasskey;

/**
 * The station's invitations, newest first
 * generated from [InvitationList](../../../../../apps/api/data/contracts/users/invitations.types.ck)
 */
export interface InvitationList {
    data: Invitation[];
}

/** Rehydrates every wire-encoded scalar in a InvitationList into its runtime type. Mutates and returns `raw`. */
export function reviveInvitationList(raw: InvitationList): InvitationList {
    const __o0 = raw as unknown as Record<string, unknown>;
    {
        const __a1 = __o0['data'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveInvitation(__a1[__i2] as never);
        }
    }
    return raw;
}
