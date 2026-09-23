import { randomBytes } from 'node:crypto';
import { Injectable } from 'injectkit';
import { AuthenticationSessionService, createOAuthClientSecret, validateRegisteredRedirectUri } from '@maroonedsoftware/authentication';
import { httpError } from '@maroonedsoftware/errors';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { StrongFactorGate } from '#modules/authentication/strong.factor.gate.js';
import { endGrantSessions } from './oauth.grant.sessions.js';
import { DeadairOAuthClientRepository, type StoredOAuthClient } from './repositories/oauth.client.repository.js';
import { DeadairOAuthGrantRepository } from './repositories/oauth.grant.repository.js';
import type { OAuthClientCreate, OAuthClientIssued, OAuthClientList, OAuthClientSummary } from './types/oauth.types.js';

/** A client as the console lists it. Never its secret hash. */
function toSummary(client: StoredOAuthClient): OAuthClientSummary {
    return {
        clientId: client.clientId,
        kind: client.kind === 'dynamic' ? 'dynamic' : 'preregistered',
        ...(client.clientName === undefined ? {} : { name: client.clientName }),
        redirectUris: client.redirectUris,
        tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
        createdAt: client.createdAt,
        ...(client.lastUsedAt === undefined ? {} : { lastUsedAt: client.lastUsedAt }),
        ...(client.expiresAt === undefined ? {} : { expiresAt: client.expiresAt }),
    };
}

/**
 * The apps registered with the station: the ones that registered themselves, and the ones an
 * operator registers by hand for a client that cannot. An operator's job, behind `platform.manage`.
 *
 * Registering one by hand sits behind the same step-up as issuing an API key: an app with a secret
 * is a credential, even though it can do nothing until somebody signed in approves it. Withdrawing
 * one ends every approval of it and every session it holds, since an app somebody has withdrawn
 * should not keep working until its tokens happen to run out.
 */
@Injectable()
export class OAuthClientsService {
    constructor(
        private readonly authz: AuthorizationContext,
        private readonly clients: DeadairOAuthClientRepository,
        private readonly grants: DeadairOAuthGrantRepository,
        private readonly sessions: AuthenticationSessionService,
        private readonly strongFactorGate: StrongFactorGate,
    ) {}

    async list(): Promise<OAuthClientList> {
        this.authz.requireAuthentication();
        return { clients: (await this.clients.listAll()).map(toSummary) };
    }

    async create(request: OAuthClientCreate): Promise<OAuthClientIssued> {
        const { actorId } = this.authz.requireAuthentication();

        const redirectUris = [...new Set(request.redirectUris.map(uri => uri.trim()).filter(uri => uri.length > 0))];
        if (redirectUris.length === 0) throw httpError(400).withDetails({ redirectUris: 'an app needs at least one address to be sent back to' });
        const refused = redirectUris.filter(uri => validateRegisteredRedirectUri(uri) !== undefined);
        if (refused.length > 0) {
            throw httpError(400).withDetails({ redirectUris: `not an https address, or this computer's own: ${refused.join(', ')}` });
        }

        await this.strongFactorGate.assertRecentIfAnyEnrolled(actorId);

        const secret = request.tokenEndpointAuthMethod === 'none' ? undefined : createOAuthClientSecret();
        const client = await this.clients.createPreregistered(
            {
                clientId: `pre_${randomBytes(16).toString('base64url')}`,
                kind: 'preregistered',
                clientName: request.name.trim(),
                redirectUris,
                tokenEndpointAuthMethod: request.tokenEndpointAuthMethod,
                ...(secret === undefined ? {} : { secretHash: secret.secretHash }),
            },
            actorId,
        );
        return { client: toSummary(client), ...(secret === undefined ? {} : { clientSecret: secret.secret }) };
    }

    async revoke(clientId: string): Promise<void> {
        this.authz.requireAuthentication();
        if (!(await this.clients.revoke(clientId))) throw httpError(404).withDetails({ clientId: 'no such app' });

        for (const grant of await this.grants.revokeForClient(clientId)) {
            await endGrantSessions(this.sessions, grant.subject, grant.id);
        }
    }
}
