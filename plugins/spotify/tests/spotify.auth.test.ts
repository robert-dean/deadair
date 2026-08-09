import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SPOTIFY_SCOPES, TOKEN_EXPIRY_SKEW_MS } from '../src/spotify.manifest.js';
import { HostVaultAuthStrategy } from '../src/spotify.auth.js';
import { createFakePluginHost, fakeHostFetchResponse } from './fake.plugin.host.js';

function tokenResponse(overrides: Partial<Parameters<typeof fakeHostFetchResponse>[0]> = {}) {
    return fakeHostFetchResponse({
        body: '{"access_token":"access-1","refresh_token":"refresh-1","expires_in":3600}',
        url: 'https://accounts.spotify.com/api/token',
        ...overrides,
    });
}

/** Independent re-derivation of RFC 7636's S256 challenge, so the test does not hardcode a digest. */
async function expectedChallenge(verifier: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    let binary = '';
    for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const CLIENT_ID = 'client-abc';
const REDIRECT_URI = 'https://example.test/callback';

describe('HostVaultAuthStrategy', () => {
    beforeEach(() => {
        vi.useRealTimers();
    });

    describe('getAuthorizeUrl', () => {
        it('builds the authorize URL with PKCE params and stores the verifier', async () => {
            const host = createFakePluginHost();
            host.queueResponse(tokenResponse());
            const strategy = new HostVaultAuthStrategy(host, CLIENT_ID, REDIRECT_URI);

            const url = await strategy.getAuthorizeUrl('state-1');
            const parsed = new URL(url);

            expect(parsed.origin + parsed.pathname).toBe('https://accounts.spotify.com/authorize');
            expect(parsed.searchParams.get('client_id')).toBe(CLIENT_ID);
            expect(parsed.searchParams.get('response_type')).toBe('code');
            expect(parsed.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
            expect(parsed.searchParams.get('scope')).toBe(SPOTIFY_SCOPES.join(' '));
            expect(parsed.searchParams.get('state')).toBe('state-1');
            expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');

            const stored = host.getStorageEntry('oauth.pkce.state-1') as { verifier: string; createdAt: number };
            expect(stored.verifier).toEqual(expect.any(String));
            const wantChallenge = await expectedChallenge(stored.verifier);
            expect(parsed.searchParams.get('code_challenge')).toBe(wantChallenge);
        });

        it('prunes verifiers older than the TTL and keeps fresh ones', async () => {
            const host = createFakePluginHost();
            host.queueResponse(tokenResponse());
            const now = Date.now();
            host.seedStorage('oauth.pkce.stale', { verifier: 'v-stale', createdAt: now - 11 * 60 * 1000 });
            host.seedStorage('oauth.pkce.fresh', { verifier: 'v-fresh', createdAt: now - 1000 });

            const strategy = new HostVaultAuthStrategy(host, CLIENT_ID, REDIRECT_URI);
            await strategy.getAuthorizeUrl('state-2');

            expect(host.storageKeys()).not.toContain('oauth.pkce.stale');
            expect(host.storageKeys()).toContain('oauth.pkce.fresh');
        });
    });

    describe('handleCallback', () => {
        it('throws when Spotify denied authorization', async () => {
            const host = createFakePluginHost();
            const strategy = new HostVaultAuthStrategy(host, CLIENT_ID, REDIRECT_URI);

            await expect(strategy.handleCallback({ error: 'access_denied' })).rejects.toThrow('Spotify authorisation was refused: access_denied');
        });

        it('throws when the callback carries no code', async () => {
            const host = createFakePluginHost();
            const strategy = new HostVaultAuthStrategy(host, CLIENT_ID, REDIRECT_URI);

            await expect(strategy.handleCallback({ state: 'state-3' })).rejects.toThrow('Spotify callback carried no authorization code');
        });

        it('throws when there is no matching PKCE verifier', async () => {
            const host = createFakePluginHost();
            const strategy = new HostVaultAuthStrategy(host, CLIENT_ID, REDIRECT_URI);

            await expect(strategy.handleCallback({ code: 'auth-code', state: 'unknown-state' })).rejects.toThrow(/no matching PKCE verifier/);
        });

        it('throws when the callback carries no state at all', async () => {
            const host = createFakePluginHost();
            const strategy = new HostVaultAuthStrategy(host, CLIENT_ID, REDIRECT_URI);

            await expect(strategy.handleCallback({ code: 'auth-code' })).rejects.toThrow(/no matching PKCE verifier/);
        });

        it('posts code_verifier and client_id, and sends no Authorization header', async () => {
            const host = createFakePluginHost();
            host.queueResponse(tokenResponse());
            const strategy = new HostVaultAuthStrategy(host, CLIENT_ID, REDIRECT_URI);

            await strategy.getAuthorizeUrl('state-4');
            const stored = host.getStorageEntry('oauth.pkce.state-4') as { verifier: string };

            await strategy.handleCallback({ code: 'auth-code', state: 'state-4' });

            expect(host.calls).toHaveLength(1);
            const [call] = host.calls;
            expect(call.url).toBe('https://accounts.spotify.com/api/token');
            const body = new URLSearchParams(call.body);
            expect(body.get('grant_type')).toBe('authorization_code');
            expect(body.get('code')).toBe('auth-code');
            expect(body.get('redirect_uri')).toBe(REDIRECT_URI);
            expect(body.get('code_verifier')).toBe(stored.verifier);
            expect(body.get('client_id')).toBe(CLIENT_ID);
            expect(call.headers?.authorization).toBeUndefined();
        });

        it('exchanges the code for tokens, persists them, and logs on success', async () => {
            const host = createFakePluginHost();
            host.queueResponse(tokenResponse());
            const strategy = new HostVaultAuthStrategy(host, CLIENT_ID, REDIRECT_URI);

            await strategy.getAuthorizeUrl('state-4b');
            await strategy.handleCallback({ code: 'auth-code', state: 'state-4b' });

            expect(host.getVaultTokens()).toEqual({
                accessToken: 'access-1',
                refreshToken: 'refresh-1',
                expiresAt: expect.any(String),
            });
            expect(host.logger.info).toHaveBeenCalledWith('spotify authorisation completed');

            // The verifier is single-use: it is consumed once the callback succeeds.
            expect(host.storageKeys()).not.toContain('oauth.pkce.state-4b');
        });

        it('throws when the token endpoint responds with a non-2xx status', async () => {
            const host = createFakePluginHost();
            host.queueResponse(tokenResponse({ status: 400, statusText: 'Bad Request', body: '' }));
            const strategy = new HostVaultAuthStrategy(host, CLIENT_ID, REDIRECT_URI);
            await strategy.getAuthorizeUrl('state-5');

            await expect(strategy.handleCallback({ code: 'auth-code', state: 'state-5' })).rejects.toThrow('Spotify token request failed (HTTP 400)');
        });

        it('throws when the token response carries no access token', async () => {
            const host = createFakePluginHost();
            host.queueResponse(tokenResponse({ body: '{"token_type":"Bearer"}' }));
            const strategy = new HostVaultAuthStrategy(host, CLIENT_ID, REDIRECT_URI);
            await strategy.getAuthorizeUrl('state-6');

            await expect(strategy.handleCallback({ code: 'auth-code', state: 'state-6' })).rejects.toThrow(
                'Spotify token response carried no access token',
            );
        });
    });

    describe('getAccessToken / getOrCreateAccessToken', () => {
        it('returns null from getAccessToken when never connected', async () => {
            const host = createFakePluginHost();
            const strategy = new HostVaultAuthStrategy(host, CLIENT_ID, REDIRECT_URI);

            await expect(strategy.getAccessToken()).resolves.toBeNull();
        });

        it('throws the "not connected yet" message from getOrCreateAccessToken when never connected', async () => {
            const host = createFakePluginHost();
            const strategy = new HostVaultAuthStrategy(host, CLIENT_ID, REDIRECT_URI);

            await expect(strategy.getOrCreateAccessToken()).rejects.toThrow(
                'Spotify is not connected yet; authorise the plugin from its settings card',
            );
        });

        it('returns the stored access token mapped to AccessToken shape', async () => {
            const host = createFakePluginHost();
            host.seedTokens({ accessToken: 'stored-access', refreshToken: 'stored-refresh', expiresAt: String(Date.now() + 60_000) });
            const strategy = new HostVaultAuthStrategy(host, CLIENT_ID, REDIRECT_URI);

            const token = await strategy.getAccessToken();
            expect(token?.access_token).toBe('stored-access');
            expect(token?.refresh_token).toBe('stored-refresh');
            expect(token?.token_type).toBe('Bearer');
            expect(token?.expires_in).toBeGreaterThan(0);
        });

        it('removeAccessToken clears the in-memory cache so the vault is re-read', async () => {
            const host = createFakePluginHost();
            host.seedTokens({ accessToken: 'a1', expiresAt: String(Date.now() + 60_000) });
            const strategy = new HostVaultAuthStrategy(host, CLIENT_ID, REDIRECT_URI);

            await strategy.getAccessToken();
            strategy.removeAccessToken();

            // Simulate the vault being cleared out from under the strategy.
            (host.oauth.getTokens as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
            await expect(strategy.getAccessToken()).resolves.toBeNull();
        });
    });

    describe('refresh flow', () => {
        it('refreshes a stale token via getBearer and persists the new one', async () => {
            const host = createFakePluginHost();
            host.queueResponse(tokenResponse({ body: '{"access_token":"fresh-access","expires_in":3600}' }));
            host.seedTokens({ accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: String(Date.now() - 1000) });
            const strategy = new HostVaultAuthStrategy(host, CLIENT_ID, REDIRECT_URI);

            const bearer = await strategy.getBearer();

            expect(bearer).toBe('fresh-access');
            expect(host.calls).toHaveLength(1);
            const body = new URLSearchParams(host.calls[0].body);
            expect(body.get('grant_type')).toBe('refresh_token');
            expect(body.get('refresh_token')).toBe('old-refresh');
            expect(host.getVaultTokens()).toMatchObject({ accessToken: 'fresh-access', refreshToken: 'old-refresh' });
        });

        it('keeps the prior refresh token when Spotify omits a new one', async () => {
            const host = createFakePluginHost();
            host.queueResponse(tokenResponse({ body: '{"access_token":"fresh-access","expires_in":3600}' }));
            host.seedTokens({ accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: String(Date.now() - 1000) });
            const strategy = new HostVaultAuthStrategy(host, CLIENT_ID, REDIRECT_URI);

            await strategy.getBearer();

            expect(host.getVaultTokens()?.refreshToken).toBe('old-refresh');
        });

        it('treats a token within the expiry skew as stale and refreshes it', async () => {
            const host = createFakePluginHost();
            host.queueResponse(tokenResponse({ body: '{"access_token":"fresh-access","expires_in":3600}' }));
            host.seedTokens({
                accessToken: 'about-to-expire',
                refreshToken: 'refresh-x',
                expiresAt: String(Date.now() + TOKEN_EXPIRY_SKEW_MS - 1),
            });
            const strategy = new HostVaultAuthStrategy(host, CLIENT_ID, REDIRECT_URI);

            const bearer = await strategy.getBearer();

            expect(bearer).toBe('fresh-access');
            expect(host.calls).toHaveLength(1);
        });

        it('does not refresh a healthy token via getBearer', async () => {
            const host = createFakePluginHost();
            host.seedTokens({ accessToken: 'healthy-access', refreshToken: 'refresh-y', expiresAt: String(Date.now() + 60_000) });
            const strategy = new HostVaultAuthStrategy(host, CLIENT_ID, REDIRECT_URI);

            const bearer = await strategy.getBearer();

            expect(bearer).toBe('healthy-access');
            expect(host.calls).toHaveLength(0);
        });

        it('forceRefresh refreshes even a healthy token', async () => {
            const host = createFakePluginHost();
            host.queueResponse(tokenResponse({ body: '{"access_token":"forced-fresh","expires_in":3600}' }));
            host.seedTokens({ accessToken: 'healthy-access', refreshToken: 'refresh-z', expiresAt: String(Date.now() + 60_000) });
            const strategy = new HostVaultAuthStrategy(host, CLIENT_ID, REDIRECT_URI);

            const bearer = await strategy.forceRefresh();

            expect(bearer).toBe('forced-fresh');
            expect(host.calls).toHaveLength(1);
        });

        it('throws a specific error when a stale token has no refresh token stored', async () => {
            const host = createFakePluginHost();
            host.seedTokens({ accessToken: 'expired-access', expiresAt: String(Date.now() - 1000) });
            const strategy = new HostVaultAuthStrategy(host, CLIENT_ID, REDIRECT_URI);

            await expect(strategy.getBearer()).rejects.toThrow(
                'Spotify access token has expired and no refresh token is stored; re-authorise the plugin',
            );
        });

        it('coalesces concurrent refreshes into a single token request', async () => {
            const host = createFakePluginHost();
            let fetchCalls = 0;
            host.setFetchImpl(async () => {
                fetchCalls += 1;
                return fakeHostFetchResponse({
                    body: '{"access_token":"fresh-once","expires_in":3600}',
                    url: 'https://accounts.spotify.com/api/token',
                });
            });
            host.seedTokens({ accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: String(Date.now() - 1000) });
            const strategy = new HostVaultAuthStrategy(host, CLIENT_ID, REDIRECT_URI);

            const [first, second, third] = await Promise.all([strategy.getBearer(), strategy.getBearer(), strategy.getBearer()]);

            expect(first).toBe('fresh-once');
            expect(second).toBe('fresh-once');
            expect(third).toBe('fresh-once');
            expect(fetchCalls).toBe(1);
        });
    });
});
