import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { ErrorCodes } from '@deadair/error-codes';
import { parseAndValidateArray } from '@maroonedsoftware/zod';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { SessionActivityService } from './session.activity.service.js';
import { AuthSession, Session } from '#modules/authentication/types/authentication.types.js';
import { ResponseCookieJar } from './response.cookie.jar.js';

@Injectable()
export class SessionsService {
    constructor(
        private readonly activity: SessionActivityService,
        private readonly authz: AuthorizationContext,
        private readonly responseCookieJar: ResponseCookieJar,
    ) {}

    async listForActor(actorId: string): Promise<{ data: Session[] }> {
        this.authz.requirePlatformRole('admin');
        return this.list(actorId);
    }

    async revoke(sessionToken: string): Promise<void> {
        this.authz.requirePlatformRole('admin');
        await this.activity.revokeSession(sessionToken);
    }

    async listForCurrentUser(): Promise<{ data: Session[] }> {
        const { actorId, sessionToken } = this.authz.requireAuthentication();
        return this.list(actorId, sessionToken);
    }

    private async list(actorId: string, currentSessionToken?: string): Promise<{ data: Session[] }> {
        const sessions = await this.activity.listSessionsForActor(actorId, currentSessionToken);
        return { data: await parseAndValidateArray(sessions, Session) };
    }

    /**
     * Self sign-out for the caller's current session.
     *
     * Tolerates an unauthenticated caller by design (the route carries `security: none`, so no
     * policy gate runs). Signing out must always mean signed out: if an expired access token got a
     * 401 here, the httpOnly refresh cookie would survive for its full 30 days and the next page
     * load would silently redeem it back into a session. So the cookie is dropped unconditionally,
     * and the session is revoked only when there is an authenticated actor to revoke it for.
     */
    async revokeCurrentSession(): Promise<void> {
        // Unconditional, and first: whatever else happens, the browser stops holding a refresh
        // token. refreshCookieMiddleware drains this on the way out, error paths included.
        this.responseCookieJar.clearRefreshToken();

        // No human actor (expired/absent/invalid bearer) means there is no session to revoke.
        // The cookie is already cleared, so report success rather than 401.
        const actor = this.authz.actor;
        if (actor.kind !== 'user') return;

        const { actorId, sessionToken } = actor;
        // Authorize: a user can only revoke their own sessions. Confirm the session still belongs
        // to the caller. We use the package's own per-subject index via SessionActivityService.
        // Anything not on that index is either someone else's session or already gone.
        const mine = await this.activity.listSessionsForActor(actorId);
        const owns = mine.some(s => s.sessionToken === sessionToken);
        if (!owns) {
            throw httpError(403).withDetails({ code: ErrorCodes.SESSION_NOT_OWNED_BY_CALLER, message: 'session does not belong to caller' });
        }
        await this.activity.revokeSession(sessionToken);
    }

    /**
     * Who the caller is, and which platform roles they hold.
     *
     * The roles are already on the actor: the authorization middleware loads them from the tuple
     * store once per request, and nothing else in the process ever needed to hand them to a
     * client, because the console draws every control and lets the API say 403. A phone would
     * rather not draw a Skip button it is about to be refused, so this answers the question up
     * front. Sorted, so two reads of the same account compare equal.
     */
    async readCurrentSession(): Promise<AuthSession> {
        const actor = this.authz.requireUser();
        return { actorId: actor.actorId, roles: [...actor.platformRoles].sort() };
    }

    async revokeMyOtherSessions(): Promise<void> {
        const { actorId, sessionToken } = this.authz.requireAuthentication();
        await this.activity.revokeAllOtherSessions(actorId, sessionToken);
    }
}
