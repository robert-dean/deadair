import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { ApiKeyService, type ApiKey as StoredApiKey, type ApiKeyIssued as StoredApiKeyIssued } from '@maroonedsoftware/authentication';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { ApiKey, ApiKeyCreate, ApiKeyIssued, ApiKeyList } from './types/authentication.types.js';
import { API_KEY_SCOPES, isApiKeyScope, type ApiKeyScope } from './api.key.scopes.js';
import { StrongFactorGate } from './strong.factor.gate.js';

/**
 * `manage` includes `view` in the permissions model, so a key asked for with `manage` alone would
 * work exactly as one asked for with both. It is stored as both anyway, so the list says what the
 * key can do rather than what somebody typed.
 */
const normaliseScopes = (requested: ReadonlyArray<string>): ApiKeyScope[] => {
    const wanted = new Set(requested.filter(isApiKeyScope));
    if (wanted.has('manage')) wanted.add('view');
    return API_KEY_SCOPES.filter(scope => wanted.has(scope));
};

/** A stored key as its owner sees it. Never the hash, and never the token after it was issued. */
const toApiKey = (key: StoredApiKey): ApiKey => ({
    id: key.id,
    name: key.name,
    hint: key.hint,
    scopes: key.scopes.filter(isApiKeyScope),
    createdAt: key.createdAt,
    ...(key.expiresAt ? { expiresAt: key.expiresAt } : {}),
    ...(key.lastUsedAt ? { lastUsedAt: key.lastUsedAt } : {}),
    ...(key.revokedAt ? { revokedAt: key.revokedAt } : {}),
});

const toIssued = (issued: StoredApiKeyIssued): ApiKeyIssued => ({ key: toApiKey(issued.key), token: issued.token });

/**
 * The account's own API keys: list, issue, rotate, revoke.
 *
 * Every method starts with `requireAuthentication`, which refuses a request made with a key. That is
 * the whole of why a leaked key cannot mint a longer-lived one, rotate itself out from under its
 * owner, or revoke the owner's other keys, and why this is not `requireUser`, which would let a key
 * through.
 *
 * Ownership is decided here and not by ServerKit, whose service knows only whether an id exists:
 * a key that is not the caller's answers 404, the same as one that never existed, so the ids of
 * other people's keys cannot be probed for. Issuing and rotating sit behind the same step-up as
 * enrolling a factor, because each hands out a credential that acts as the account; revoking does
 * not, because taking access away is never the change a stolen session wants.
 */
@Injectable()
export class ApiKeysService {
    constructor(
        private readonly apiKeys: ApiKeyService,
        private readonly authz: AuthorizationContext,
        private readonly strongFactorGate: StrongFactorGate,
    ) {}

    async list(): Promise<ApiKeyList> {
        const { actorId } = this.authz.requireAuthentication();
        const keys = await this.apiKeys.listForOwner({ kind: 'user', actorId }, { includeInactive: true });
        return { keys: keys.map(toApiKey) };
    }

    async create(request: ApiKeyCreate): Promise<ApiKeyIssued> {
        const { actorId } = this.authz.requireAuthentication();
        const scopes = normaliseScopes(request.scopes);
        if (scopes.length === 0) {
            throw httpError(400).withDetails({ scopes: 'a key needs at least one scope' });
        }

        await this.strongFactorGate.assertRecentIfAnyEnrolled(actorId);

        const issued = await this.apiKeys.create({
            owner: { kind: 'user', actorId },
            name: request.name.trim(),
            scopes,
            ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
        });
        return toIssued(issued);
    }

    async rotate(id: string): Promise<ApiKeyIssued> {
        const { actorId } = this.authz.requireAuthentication();
        await this.requireOwned(id, actorId);
        await this.strongFactorGate.assertRecentIfAnyEnrolled(actorId);
        return toIssued(await this.apiKeys.rotate(id));
    }

    /** Revoking a key that is already revoked keeps the first revocation and answers the same. */
    async revoke(id: string): Promise<void> {
        const { actorId } = this.authz.requireAuthentication();
        await this.requireOwned(id, actorId);
        await this.apiKeys.revoke(id);
    }

    private async requireOwned(id: string, actorId: string): Promise<StoredApiKey> {
        const key = await this.apiKeys.get(id);
        if (!key || key.owner.kind !== 'user' || key.owner.actorId !== actorId) {
            throw httpError(404).withDetails({ id: 'not found' });
        }
        return key;
    }
}
