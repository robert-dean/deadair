import { createHash, randomBytes } from 'node:crypto';
import { DateTime, Duration } from 'luxon';
import type { PlatformRoleName } from '#modules/permissions/platform.roles.js';

/** Says what a pasted token is, as the party pass's `dp_` does. */
export const INVITATION_TOKEN_PREFIX = 'di_';

/** How long an invitation's link works. An admin's is shorter: whoever opens it first runs the station. */
export const INVITATION_LIFETIME: Readonly<Record<PlatformRoleName, Duration>> = {
    admin: Duration.fromObject({ hours: 48 }),
    listener: Duration.fromObject({ days: 7 }),
};

/** A new invitation token: 256 random bits, url-safe, prefixed. */
export function mintInvitationToken(): string {
    return `${INVITATION_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** How a token is found without being stored: its sha256, hex. Trims first, since a token is often pasted. */
export function hashInvitationToken(token: string): string {
    return createHash('sha256').update(token.trim()).digest('hex');
}

/** Where an invitation stands, with expiry worked out from the clock rather than stored. */
export function invitationState(row: { state: 'pending' | 'accepted' | 'revoked'; expiresAt: DateTime }, now: DateTime = DateTime.utc()) {
    if (row.state === 'pending' && row.expiresAt <= now) return 'expired' as const;
    return row.state;
}
