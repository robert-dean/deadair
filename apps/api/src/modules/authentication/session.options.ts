import { AuthenticationSessionServiceOptions } from '@maroonedsoftware/authentication';
import { Duration } from 'luxon';

/** How long a session's access token lasts, and how long a refresh token does. */
const SESSION_TOKEN_LIFETIME = Duration.fromObject({ days: 30 });

/**
 * How long a refresh token that has been spent may be presented again and answered with the pair its
 * first exchange issued.
 *
 * Without it, any repeat revokes the token's whole family as a theft. A repeat is usually nothing of
 * the kind: two clients sharing one connector refreshing at once, or a client that lost the answer
 * and retried. Past this window a replay revokes the family as before.
 */
export const REFRESH_REUSE_GRACE = Duration.fromObject({ seconds: 30 });

/** What the session service is built with, for console sessions and OAuth grants alike. */
export function authenticationSessionOptions(): AuthenticationSessionServiceOptions {
    return new AuthenticationSessionServiceOptions('deadair', 'deadair', SESSION_TOKEN_LIFETIME, SESSION_TOKEN_LIFETIME, REFRESH_REUSE_GRACE);
}
