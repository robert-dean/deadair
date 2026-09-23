import { AuthenticationSessionService, getOAuthSessionClaim } from '@maroonedsoftware/authentication';

/**
 * End every session an app holds through one grant: the tokens it was issued stop working on their
 * next request, and its refresh token has nothing left to refresh.
 *
 * Sessions live in Redis and know their grant only by `claims.oauth.grantId`, so this walks the
 * person's sessions rather than asking for the grant's. A person has a handful, which makes that
 * cheap; revoking the grant row as well is what stops a refresh that was already in flight.
 */
export async function endGrantSessions(sessions: AuthenticationSessionService, actorId: string, grantId: string): Promise<number> {
    const held = (await sessions.getSessionsForSubject(actorId)).filter(session => getOAuthSessionClaim(session)?.grantId === grantId);
    for (const session of held) await sessions.deleteSession(session.sessionToken, 'logout');
    return held.length;
}
