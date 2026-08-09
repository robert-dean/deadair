import { PluginError, type PluginErrorCode } from '@deadair/plugin-sdk';
import type { HostFetchInit, HostFetchMethod, PluginHost } from '@deadair/plugin-sdk';
import type { IValidateResponses, RequestImplementation } from '@spotify/web-api-ts-sdk';

import { REQUEST_TIMEOUT_MS } from './spotify.manifest.js';

const HOST_FETCH_METHODS: readonly HostFetchMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];

function toHostFetchMethod(method: string | undefined): HostFetchMethod {
    const upper = (method ?? 'GET').toUpperCase();
    const match = HOST_FETCH_METHODS.find(candidate => candidate === upper);
    if (!match) throw new Error(`Spotify fetch bridge received an unsupported method: ${method}`);
    return match;
}

/** Lowercases header names, which is the shape `HostFetchInit.headers` takes. */
function headersToRecord(headers: Headers): Record<string, string> {
    const record: Record<string, string> = {};
    headers.forEach((value, key) => {
        record[key.toLowerCase()] = value;
    });
    return record;
}

/**
 * How Spotify's statuses read in the host's vocabulary.
 *
 * A 404 is left as `not_found` rather than something softer even though the
 * player endpoints use it for "no active device": this plugin already handles
 * that case by status (see `isNoActiveDevice`), and the code is what the HOST
 * sees, where "Spotify has no such thing" is the honest summary.
 *
 * 401 and 403 are deliberately NOT the same code. A 401 is the connection
 * itself: `createHostFetch` has already refreshed the bearer and re-issued
 * once by the time one is returned, so a 401 that survives that really does
 * mean the credential is dead, and `auth` (non-retryable) quarantines the
 * plugin on the spot. A 403 is per-resource: since the February 2026 Web API
 * changes Spotify answers it for any playlist the account does not own or
 * collaborate on, which is most of the playlists in a typical library.
 * `forbidden` is resource-scoped on the host side, so those refusals are
 * reported to the caller without counting against the plugin's health.
 * Classifying them `auth` took the whole plugin down on the first one;
 * `upstream` merely took three.
 */
function pluginCodeForStatus(status: number): PluginErrorCode {
    if (status === 401) return 'auth';
    if (status === 403) return 'forbidden';
    if (status === 404) return 'not_found';
    if (status === 429) return 'rate_limited';
    if (status >= 500) return 'unavailable';
    return 'upstream';
}

/**
 * Spotify's own sentence for the failure, out of `{"error":{"message":...}}`.
 *
 * Without this the operator gets `HTTP 403` and nothing else, which is the one
 * status where the number alone does not say what to fix: "insufficient client
 * scope", "the app is in development mode" and "premium required" are three
 * different jobs. Truncated, because an upstream body is untrusted text that
 * ends up in a log line and on the settings card.
 */
function upstreamReason(body: string | undefined): string | undefined {
    if (!body) return undefined;

    let message: unknown;
    try {
        message = (JSON.parse(body) as { error?: { message?: unknown } }).error?.message;
    } catch {
        return undefined;
    }

    if (typeof message !== 'string' || message.length === 0) return undefined;
    return message.length > 200 ? `${message.slice(0, 200)}…` : message;
}

/**
 * Spotify sends `Retry-After` in whole seconds on a 429.
 *
 * Only the seconds form is read: the HTTP-date form is legal but Spotify does
 * not send it, and guessing wrong here would tell the host to sit out a wait
 * that was never asked for. Anything unparseable means "no advice given".
 */
function retryAfterMs(header: string | null): number | undefined {
    if (header === null) return undefined;
    const seconds = Number(header.trim());
    if (!Number.isFinite(seconds) || seconds < 0) return undefined;
    return seconds * 1000;
}

/**
 * Thrown by {@link SpotifyResponseValidator} in place of the SDK's bare
 * `Error`, so a caller can branch on the HTTP status instead of parsing a
 * message string. This is what lets `getTrack` turn a 404 into `undefined`
 * and `testConnection` report a readable status.
 *
 * It extends {@link PluginError} so the same failure keeps its meaning once it
 * leaves the plugin: `status` is for this plugin's own branching, `code` is
 * what the host maps to a response. `body` deliberately stays off the base
 * class, because the host logs and returns what a `PluginError` carries and an
 * upstream error body is not ours to forward.
 */
export class SpotifyRequestError extends PluginError {
    readonly status: number;
    readonly body?: string;

    constructor(status: number, message: string, body?: string, retryAfterMs?: number) {
        super(message);
        this.name = 'SpotifyRequestError';
        this.status = status;
        this.body = body;

        this.withCode(pluginCodeForStatus(status)).withUpstreamStatus(status);
        if (retryAfterMs !== undefined) this.withRetry(retryAfterMs);
    }
}

/**
 * Adapts `host.fetch` into the `RequestImplementation` shape `SpotifyApi`
 * calls internally, so every byte of Spotify traffic still passes through the
 * host: the manifest's hostname allowlist, its rate limiter, its shared
 * request deadline and its SSRF-safe redirect handling all keep applying.
 *
 * The SDK sets an `Authorization` header itself before invoking this
 * function (from whatever auth strategy it was constructed with), but this
 * bridge is the source of truth for the bearer that actually goes out on the
 * wire: it overwrites that header with `getBearer()`'s token, the same
 * staleness-aware accessor `SpotifyPlugin.apiFetch` used to call. On a 401,
 * it calls `forceRefresh()` and re-issues the request exactly once with the
 * new bearer; a second 401 is returned as-is. This replaces the
 * `retryOnUnauthorized` behaviour that used to live in `SpotifyPlugin.apiFetch`.
 */
export function createHostFetch(host: PluginHost, getBearer: () => Promise<string>, forceRefresh: () => Promise<string>): RequestImplementation {
    async function issue(url: string, init: RequestInit | undefined, headers: Record<string, string>): Promise<Response> {
        const rawBody = init?.body;
        if (rawBody !== undefined && typeof rawBody !== 'string') {
            throw new Error('Spotify fetch bridge only supports string request bodies');
        }

        const hostInit: HostFetchInit = {
            method: toHostFetchMethod(init?.method),
            headers,
            body: rawBody,
            timeoutMs: REQUEST_TIMEOUT_MS,
        };

        // Straight through: `host.fetch` answers with a real `Response`, which
        // is exactly what the SDK's `RequestImplementation` is typed to return.
        // This used to rebuild one field by field from a POJO, and had to
        // special-case 204/205/304 while doing it, because the Response
        // constructor rejects a body on those and Spotify answers 204 on every
        // player transport call.
        return await host.fetch(url.toString(), hostInit);
    }

    return async (input, init) => {
        // `SpotifyApi.makeRequest` always calls `sdkConfig.fetch(fullUrl, opts)`
        // with a string URL, but `RequestImplementation` is typed against the
        // full `RequestInfo | URL` fetch signature; `.url` covers a `Request`.
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const headers = headersToRecord(new Headers(init?.headers));

        const bearer = await getBearer();
        headers.authorization = `Bearer ${bearer}`;

        const first = await issue(url, init, headers);
        if (first.status !== 401) return first;

        const refreshed = await forceRefresh();
        const retryHeaders = { ...headers, authorization: `Bearer ${refreshed}` };
        return issue(url, init, retryHeaders);
    };
}

/**
 * Replaces the SDK's `DefaultResponseValidator`. Same non-2xx-rejects
 * contract, except it throws {@link SpotifyRequestError} carrying the numeric
 * status (and body text, when there is one) instead of a bare `Error` that
 * erases it.
 */
export class SpotifyResponseValidator implements IValidateResponses {
    async validateResponse(response: Response): Promise<void> {
        if (response.status.toString().startsWith('20')) return;

        let body: string | undefined;
        try {
            body = await response.text();
        } catch {
            body = undefined;
        }

        // `statusText` is empty over HTTP/2, which is every real call to
        // Spotify, so it is joined rather than interpolated: otherwise the
        // message ends in a dangling space where the status word should be.
        const status = [`HTTP ${response.status}`, response.statusText, upstreamReason(body)].filter(part => part).join(' ');

        throw new SpotifyRequestError(
            response.status,
            `Spotify API request failed: ${status}`,
            body,
            retryAfterMs(response.headers.get('retry-after')),
        );
    }
}
