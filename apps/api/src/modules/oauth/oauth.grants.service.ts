import { Injectable } from 'injectkit';
import { AuthenticationSessionService, OAuthClientResolver, type OAuthGrant as StoredGrant } from '@maroonedsoftware/authentication';
import { httpError } from '@maroonedsoftware/errors';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { endGrantSessions } from './oauth.grant.sessions.js';
import { DeadairOAuthGrantRepository } from './repositories/oauth.grant.repository.js';
import type { OAuthGrant, OAuthGrantList } from './types/oauth.types.js';

/**
 * The apps the signed-in person has let act as them, and a way to disconnect one.
 *
 * Their own approvals only: a grant that is not theirs answers 404, the same as one that never
 * existed. Disconnecting needs no step-up, since taking access away is never what a stolen session
 * wants. It ends the grant and every session the app holds through it, at once.
 */
@Injectable()
export class OAuthGrantsService {
    constructor(
        private readonly authz: AuthorizationContext,
        private readonly grants: DeadairOAuthGrantRepository,
        private readonly clients: OAuthClientResolver,
        private readonly sessions: AuthenticationSessionService,
    ) {}

    async list(): Promise<OAuthGrantList> {
        const { actorId } = this.authz.requireAuthentication();
        const grants = await this.grants.listForActor(actorId);
        return { grants: await Promise.all(grants.map(grant => this.toContract(grant))) };
    }

    async revoke(id: string): Promise<void> {
        const { actorId } = this.authz.requireAuthentication();
        const grant = await this.grants.revoke(id, actorId);
        if (grant === undefined) throw httpError(404).withDetails({ id: 'no such connection' });
        await endGrantSessions(this.sessions, actorId, grant.id);
    }

    /**
     * A grant with the app's name, when the station can still find the app. A self-registered app
     * that has lapsed, or a metadata document that no longer answers, leaves the name out rather
     * than failing the whole list.
     */
    private async toContract(grant: StoredGrant): Promise<OAuthGrant> {
        const client = await this.clients.resolve(grant.clientId).catch(() => undefined);
        return {
            id: grant.id,
            clientId: grant.clientId,
            ...(client?.clientName === undefined ? {} : { clientName: client.clientName }),
            resource: grant.resource,
            scope: grant.scope,
            createdAt: grant.createdAt,
            ...(grant.lastUsedAt === undefined ? {} : { lastUsedAt: grant.lastUsedAt }),
        };
    }
}
