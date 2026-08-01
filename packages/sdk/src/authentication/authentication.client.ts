import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson } from '../sdk-options.js';
import type {
    AuthenticationLoginStart,
    AuthenticationLoginStartResponse,
    AuthenticationRegistration,
    AuthenticationRegistrationInput,
    AuthenticationRegistrationVerification,
    AuthenticationRequest,
    AuthenticationToken,
    AuthenticationTokenOutput,
    AuthenticationTokenResponse,
    AuthenticationTokenResponseOutput,
} from './types/authentication.types.js';
import { AuthenticationFactorsClient } from './authentication.factor.client.js';
import { AuthenticationSessionsClient } from './authentication.sessions.client.js';

export class AuthenticationClient {
    readonly factors: AuthenticationFactorsClient;
    readonly sessions: AuthenticationSessionsClient;

    constructor(private fetch: SdkFetch) {
        this.factors = new AuthenticationFactorsClient(fetch);
        this.sessions = new AuthenticationSessionsClient(fetch);
    }

    /**
     * @name Request token
     * @description Request authenticated token
     */
    async requestToken(
        body: AuthenticationRequest,
        options?: { contentType?: 'application/x-www-form-urlencoded' | 'application/json' },
    ): Promise<AuthenticationTokenResponseOutput> {
        const __contentType = options?.contentType ?? 'application/x-www-form-urlencoded';
        const __serialized =
            __contentType === 'application/x-www-form-urlencoded'
                ? new URLSearchParams(body as unknown as Record<string, string>).toString()
                : JSON.stringify(body, bigIntReplacer);
        const result = await this.fetch(`/auth/token`, {
            method: 'POST',
            headers: { 'Content-Type': __contentType },
            body: __serialized,
        });
        return await parseJson<AuthenticationTokenResponseOutput>(result);
    }

    /**
     * @name Register login
     * @description Register a new login
     */
    async registerLogin(body: AuthenticationRegistrationInput): Promise<AuthenticationRegistration> {
        const result = await this.fetch(`/auth/login/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<AuthenticationRegistration>(result);
    }

    /**
     * @name Verify login registration
     * @description Verify a login registration
     */
    async verifyLoginRegistration(body: AuthenticationRegistrationVerification): Promise<AuthenticationTokenOutput> {
        const result = await this.fetch(`/auth/login/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<AuthenticationTokenOutput>(result);
    }

    /**
     * @name Start login
     * @description Start a password-less login process
     */
    async startLogin(body: AuthenticationLoginStart): Promise<AuthenticationLoginStartResponse> {
        const result = await this.fetch(`/auth/login/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<AuthenticationLoginStartResponse>(result);
    }
}
