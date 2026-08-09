import { PluginError, tryJsonBody, type PluginHost } from '@deadair/plugin-sdk';
import type { AccessToken, IAuthStrategy } from '@spotify/web-api-ts-sdk';

import { ACCOUNTS_ORIGIN, DEFAULT_TOKEN_LIFETIME_S, REQUEST_TIMEOUT_MS, SPOTIFY_SCOPES, TOKEN_EXPIRY_SKEW_MS } from './spotify.manifest.js';

/**
 * In-memory view of the OAuth vault's contents. Unchanged from the
 * hand-written client-credentials flow this replaces: the vault record shape
 * never depended on how the code was obtained.
 */
interface StoredTokens {
    accessToken: string;
    refreshToken?: string;
    /** Unix epoch millis. */
    expiresAt: number;
}

interface SpotifyTokenResponse {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
}

/** A PKCE verifier parked in `host.storage` between `getAuthorizeUrl` and the callback. */
interface StoredVerifier {
    verifier: string;
    /** Unix epoch millis, so a prune sweep can tell a stale entry from a live one. */
    createdAt: number;
}

const PKCE_STORAGE_PREFIX = 'oauth.pkce.';

/**
 * Matches the host's own `PLUGIN_OAUTH_STATE_TTL_MS`
 * (`apps/api/src/modules/plugins/plugin.oauth.state.store.ts`): a verifier
 * outliving the `state` it is keyed on is already unredeemable, so there is
 * no reason to keep it around any longer than the host does.
 */
const PKCE_VERIFIER_TTL_MS = 10 * 60 * 1000;

/** The message a plugin that has never completed a flow throws. Copied verbatim from the hand-written flow. */
const NOT_CONNECTED_ERROR = 'Spotify is not connected yet; authorise the plugin from its settings card';

/** Base64url, no padding, per RFC 7636. `btoa` is fine: both inputs here are raw random bytes and a SHA-256 digest. */
function base64UrlEncode(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh PKCE pair: a 48-byte random verifier and its S256 challenge. Web Crypto only, no `node:` import. */
async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
    const verifierBytes = new Uint8Array(48);
    crypto.getRandomValues(verifierBytes);
    const verifier = base64UrlEncode(verifierBytes);

    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = base64UrlEncode(new Uint8Array(digest));

    return { verifier, challenge };
}

function isStoredVerifier(value: unknown): value is StoredVerifier {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as StoredVerifier).verifier === 'string' &&
        typeof (value as StoredVerifier).createdAt === 'number'
    );
}

function verifierKey(state: string): string {
    return `${PKCE_STORAGE_PREFIX}${state}`;
}

function toAccessToken(tokens: StoredTokens): AccessToken {
    return {
        access_token: tokens.accessToken,
        token_type: 'Bearer',
        expires_in: Math.max(0, Math.round((tokens.expiresAt - Date.now()) / 1000)),
        refresh_token: tokens.refreshToken ?? '',
        expires: tokens.expiresAt,
    };
}

/**
 * The hand-written PKCE authorization-code flow against `accounts.spotify.com`,
 * plus the `IAuthStrategy` `SpotifyApi` needs to keep asking for a token.
 *
 * The SDK's own `AuthorizationCodeWithPKCEStrategy` is browser-only (it drives
 * `window.location` and `localStorage`) and its `AccessTokenHelpers.refreshToken`
 * calls global `fetch`; neither is reachable through the package's `exports` map
 * regardless, which only publishes the root entry point. So this wraps the same
 * token logic the client-credentials flow used, unchanged in shape, over
 * `host.fetch` and `host.storage`/`host.oauth` instead of a browser's.
 *
 * Access tokens are kept in `host.oauth`, never in `host.storage` (that holds
 * only the short-lived PKCE verifier) and never in a log line.
 */
export class HostVaultAuthStrategy implements IAuthStrategy {
    private tokens?: StoredTokens;

    /** Coalesces concurrent refreshes so a burst of calls spends one refresh token. */
    private refreshInFlight?: Promise<StoredTokens>;

    constructor(
        private readonly host: PluginHost,
        private readonly clientId: string,
        private readonly redirectUri: string,
    ) {}

    // --- IAuthStrategy -------------------------------------------------

    setConfiguration(): void {
        // Nothing to do: every call already carries `host`, `clientId` and
        // `redirectUri` from construction, and the SDK's `SdkConfiguration`
        // has nothing else this strategy needs.
    }

    async getOrCreateAccessToken(): Promise<AccessToken> {
        return toAccessToken(await this.resolveTokens(false));
    }

    async getAccessToken(): Promise<AccessToken | null> {
        const tokens = await this.loadTokens();
        return tokens ? toAccessToken(tokens) : null;
    }

    removeAccessToken(): void {
        this.tokens = undefined;
    }

    // --- plain-callback forms for spotify.fetch.ts's createHostFetch ---

    /** `getBearer` for `createHostFetch`: the current bearer, refreshed first if stale. */
    getBearer = (): Promise<string> => this.resolveBearer(false);

    /** `forceRefresh` for `createHostFetch`: always refreshes, for its one-shot 401 retry. */
    forceRefresh = (): Promise<string> => this.resolveBearer(true);

    /**
     * A live access token and its expiry, for the station-side helper that opens
     * its own Spotify session (see `resolveStreamUrl` on the plugin).
     *
     * Resolves to `undefined` when nothing is stored, rather than throwing the
     * way {@link resolveBearer} does: a track is resolved whenever one is due,
     * which may well be before anyone has authorised the plugin, and "not
     * connected yet" is an ordinary answer there rather than a failure.
     *
     * A stored-but-stale token is still refreshed, because handing the helper an
     * expired one would fail inside a different process with no way back here.
     */
    sessionTokens = async (): Promise<{ accessToken: string; expiresAt: number } | undefined> => {
        if (!(await this.loadTokens())) return undefined;

        const { accessToken, expiresAt } = await this.resolveTokens(false);
        return { accessToken, expiresAt };
    };

    // --- oauth -----------------------------------------------------------

    async getAuthorizeUrl(state: string): Promise<string> {
        await this.pruneStaleVerifiers();

        const { verifier, challenge } = await createPkcePair();
        const record: StoredVerifier = { verifier, createdAt: Date.now() };
        await this.host.storage.set(verifierKey(state), record);

        const url = new URL('/authorize', ACCOUNTS_ORIGIN);
        url.searchParams.set('client_id', this.clientId);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('redirect_uri', this.redirectUri);
        url.searchParams.set('scope', SPOTIFY_SCOPES.join(' '));
        url.searchParams.set('state', state);
        url.searchParams.set('code_challenge_method', 'S256');
        url.searchParams.set('code_challenge', challenge);
        return url.toString();
    }

    async handleCallback(params: Record<string, string>): Promise<void> {
        const denied = params.error;
        if (denied) throw new PluginError(`Spotify authorisation was refused: ${denied}`).withCode('auth');

        const code = params.code;
        if (!code) throw new PluginError('Spotify callback carried no authorization code').withCode('auth');

        const state = params.state;
        const verifier = state ? await this.takeVerifier(state) : undefined;
        if (!verifier)
            throw new PluginError(
                'Spotify callback arrived with no matching PKCE verifier; the authorisation attempt may have expired, retry connecting',
            ).withCode('auth');

        const tokens = await this.requestTokens(
            new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: this.redirectUri,
                code_verifier: verifier,
            }),
        );
        await this.persistTokens(tokens);
        this.host.logger.info('spotify authorisation completed');
    }

    // --- pkce verifier storage ------------------------------------------

    private async takeVerifier(state: string): Promise<string | undefined> {
        const key = verifierKey(state);
        const record = await this.host.storage.get(key);
        await this.host.storage.delete(key);
        return isStoredVerifier(record) ? record.verifier : undefined;
    }

    /** Sweeps entries older than {@link PKCE_VERIFIER_TTL_MS}, run on every authorize. */
    private async pruneStaleVerifiers(): Promise<void> {
        const cutoff = Date.now() - PKCE_VERIFIER_TTL_MS;
        const keys = await this.host.storage.list(PKCE_STORAGE_PREFIX);

        await Promise.all(
            keys.map(async key => {
                const record = await this.host.storage.get(key);
                const createdAt = isStoredVerifier(record) ? record.createdAt : undefined;
                if (createdAt === undefined || createdAt <= cutoff) await this.host.storage.delete(key);
            }),
        );
    }

    // --- token vault -------------------------------------------------------

    /** The current access token, refreshed when it is stale or `force` is set. */
    private async resolveBearer(force: boolean): Promise<string> {
        return (await this.resolveTokens(force)).accessToken;
    }

    private async resolveTokens(force: boolean): Promise<StoredTokens> {
        const tokens = await this.loadTokens();
        if (!tokens) throw new PluginError(NOT_CONNECTED_ERROR).withCode('auth');

        const stale = force || tokens.expiresAt - TOKEN_EXPIRY_SKEW_MS <= Date.now();
        if (!stale) return tokens;

        return this.refreshTokens(tokens);
    }

    private async loadTokens(): Promise<StoredTokens | undefined> {
        if (this.tokens) return this.tokens;

        const stored = await this.host.oauth.getTokens();
        const accessToken = stored?.accessToken;
        if (!accessToken) return undefined;

        const expiresAt = Number(stored?.expiresAt);
        this.tokens = {
            accessToken,
            refreshToken: stored?.refreshToken,
            // An unparseable expiry is treated as "expired": worst case that
            // costs one refresh round-trip, versus a guaranteed 401 otherwise.
            expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
        };
        return this.tokens;
    }

    private async refreshTokens(current: StoredTokens): Promise<StoredTokens> {
        if (!current.refreshToken) {
            throw new PluginError('Spotify access token has expired and no refresh token is stored; re-authorise the plugin').withCode('auth');
        }

        this.refreshInFlight ??= this.performRefresh(current.refreshToken).finally(() => {
            this.refreshInFlight = undefined;
        });

        return this.refreshInFlight;
    }

    private async performRefresh(refreshToken: string): Promise<StoredTokens> {
        // Spotify rotates the refresh token under PKCE, but may or may not send
        // a new one on any given response; keep the old one when it omits it,
        // or the connection dies after one hour.
        const tokens = await this.requestTokens(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }), refreshToken);
        await this.persistTokens(tokens);
        return tokens;
    }

    private async requestTokens(body: URLSearchParams, existingRefreshToken?: string): Promise<StoredTokens> {
        // `client_id` travels in the body on every grant now that there is no
        // client secret: PKCE's whole point is that the token endpoint no
        // longer needs a confidential credential to trust this request, just
        // proof of the `code_verifier` (or the refresh token itself).
        body.set('client_id', this.clientId);

        const response = await this.host.fetch(`${ACCOUNTS_ORIGIN}/api/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
            timeoutMs: REQUEST_TIMEOUT_MS,
        });

        // Deliberately not echoing the response body: it carries tokens.
        // A token endpoint that says 4xx is saying the grant is dead (revoked
        // refresh token, wrong client id), which the operator has to fix by
        // reconnecting; 5xx is Spotify having a bad day and worth a retry.
        if (!response.ok) {
            const code = response.status >= 500 ? 'unavailable' : 'auth';
            throw new PluginError(`Spotify token request failed (HTTP ${response.status})`).withCode(code).withUpstreamStatus(response.status);
        }

        const payload = await tryJsonBody<SpotifyTokenResponse>(response);
        const accessToken = payload?.access_token;
        if (!accessToken) throw new PluginError('Spotify token response carried no access token').withCode('upstream');

        return {
            accessToken,
            refreshToken: payload?.refresh_token ?? existingRefreshToken,
            expiresAt: Date.now() + (payload?.expires_in ?? DEFAULT_TOKEN_LIFETIME_S) * 1000,
        };
    }

    private async persistTokens(tokens: StoredTokens): Promise<void> {
        this.tokens = tokens;

        const record: Record<string, string> = {
            accessToken: tokens.accessToken,
            expiresAt: String(tokens.expiresAt),
        };
        if (tokens.refreshToken) record.refreshToken = tokens.refreshToken;

        await this.host.oauth.saveTokens(record);
    }
}
