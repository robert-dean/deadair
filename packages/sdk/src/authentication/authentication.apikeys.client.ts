import type { ApiKeyCreate, ApiKeyIssued, ApiKeyList } from './types/authentication.types.js';
import { reviveApiKeyIssued, reviveApiKeyList } from './types/authentication.types.js';
import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson } from '../sdk-options.js';

/**
 * generated from [authentication.apikeys.ck](../../../../apps/api/data/contracts/authentication/authentication.apikeys.ck)
 */
export class AuthenticationApikeysClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name List API keys
     * @description The signed-in account's API keys, newest first, including revoked and expired ones so the list says what was withdrawn and when
     */
    async listAPIKeys(): Promise<ApiKeyList> {
        const result = await this.fetch(`/auth/apikeys`, { method: 'GET' });
        return reviveApiKeyList(await parseJson<ApiKeyList>(result));
    }

    /**
     * @name Create API key
     * @description Issue a new API key for the signed-in account. The token is in this response and nowhere else, ever. Once the account has a strong second factor, this needs one verified in the last five minutes
     */
    async createAPIKey(body: ApiKeyCreate): Promise<ApiKeyIssued> {
        const result = await this.fetch(`/auth/apikeys`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return reviveApiKeyIssued(await parseJson<ApiKeyIssued>(result));
    }

    /**
     * @name Rotate API key
     * @description Give a key a new token, so the old one stops working at once. The key keeps its name, scopes and expiry. Needs the same recent second factor as creating one
     */
    async rotateAPIKey(id: string): Promise<ApiKeyIssued> {
        const result = await this.fetch(`/auth/apikeys/${encodeURIComponent(id)}/rotate`, { method: 'POST' });
        return reviveApiKeyIssued(await parseJson<ApiKeyIssued>(result));
    }

    /**
     * @name Revoke API key
     * @description Revoke a key. Every request made with it is refused from the next one on. The key stays in the list, marked revoked
     */
    async revokeAPIKey(id: string): Promise<void> {
        await this.fetch(`/auth/apikeys/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }
}
