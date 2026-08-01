import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { ErrorCodes } from '@deadair/error-codes';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { SessionActivityService, ListedSession } from './session.activity.service.js';
import { Session } from '#modules/authentication/types/authentication.types.js';

@Injectable()
export class SessionsService {
    constructor(
        private readonly activity: SessionActivityService,
        private readonly authz: AuthorizationContext,
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
        return { data: await Promise.all(sessions.map(s => this.toContract(s))) };
    }

    async revokeMySession(sessionToken: string): Promise<void> {
        const { actorId } = this.authz.requireAuthentication();
        // Authorize: a user can only revoke their own sessions. Fetch the target
        // and confirm it belongs to the caller. We use the package's own per-subject
        // index via SessionActivityService — anything not on that index is either
        // someone else's session or already gone.
        const mine = await this.activity.listSessionsForActor(actorId);
        const owns = mine.some(s => s.sessionToken === sessionToken);
        if (!owns) {
            throw httpError(403).withDetails({ code: ErrorCodes.SESSION_NOT_OWNED_BY_CALLER, message: 'session does not belong to caller' });
        }
        await this.activity.revokeSession(sessionToken);
    }

    async revokeMyOtherSessions(): Promise<void> {
        const { actorId, sessionToken } = this.authz.requireAuthentication();
        await this.activity.revokeAllOtherSessions(actorId, sessionToken);
    }

    private async toContract(s: ListedSession): Promise<Session> {
        return parseAndValidate(s, Session);
    }
}
