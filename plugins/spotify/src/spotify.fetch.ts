import {
    PluginError,
    headersToRecord,
    hostFetchMethod,
    pluginCodeForStatus as sharedCodeForStatus,
    retryAfterMs,
    truncateUpstreamMessage,
    upstreamField,
    type PluginErrorCode,
} from '@deadair/plugin-sdk';
import type { HostFetchInit, HostFetchMethod, PluginHost } from '@deadair/plugin-sdk';
import type { IValidateResponses, RequestImplementation } from '@spotify/web-api-ts-sdk';

import { REQUEST_TIMEOUT_MS } from './spotify.manifest.js';

function toHostFetchMethod(method: string | undefined): HostFetchMethod {
    const match = hostFetchMethod(method);
    if (!match) throw new Error(`Spotify fetch bridge received an unsupported method: ${method}`);
    return match;
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
    return sharedCodeForStatus(status);
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
    const message = upstreamField(body, parsed => (parsed as { error?: { message?: unknown } }).error?.message);
    return message === undefined ? undefined : truncateUpstreamMessage(message);
}

/**
 * Spotify's machine-readable cause, out of `{"error":{"reason":...}}`.
 *
 * A sibling of {@link upstreamReason} and not a replacement for it: `message` is
 * a sentence for a human, `reason` is a token to branch on, and Spotify sends
 * them independently. Defensive in the same way, because the body is whatever
 * the edge happened to send — an HTML page from a proxy, an empty 429 — and a
 * failed parse must read as "said nothing" rather than throw inside a validator.
 */
function upstreamCause(body: string | undefined): string | undefined {
    return upstreamField(body, parsed => (parsed as { error?: { reason?: unknown } }).error?.reason);
}

/**
 * The API path a response came from, as `(v1/artists/…/top-tracks)`, or nothing when it is unreadable.
 *
 * Path only. A search's query string is the caller's own words and would put a station's brief
 * inside an error message that travels further than the log line it came from.
 */
function endpointOf(url: string | undefined): string | undefined {
    if (!url) return undefined;

    try {
        return `(${new URL(url).pathname.replace(/^\//, '')})`;
    } catch {
        return undefined;
    }
}

/** The `error.reason` Spotify sends on a 429 when the app's allowance is spent rather than its burst. */
export const QUOTA_EXCEEDED_REASON = 'QUOTA_EXCEEDED';

/**
 * How long a quota 429 asks the host to wait, instead of its `Retry-After`.
 *
 * Deliberately not derived from the header. A drained quota is not a burst to
 * ride out in seconds: Spotify sends that 429 with a short `Retry-After` or none
 * at all, so honouring it spends the next window's calls on the same refusal and
 * the station walks straight back into it on its next tick. A long fixed hold
 * says the true thing instead — this one needs the window to reset, or an
 * operator to look at the app's allowance.
 */
export const QUOTA_BACKOFF_MS = 30 * 60_000;

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
    /** Spotify's own machine-readable cause, when it sent one. {@link QUOTA_EXCEEDED_REASON} is the one that changes behaviour. */
    readonly reason?: string;

    constructor(status: number, message: string, body?: string, retryAfterMs?: number) {
        super(message);
        this.name = 'SpotifyRequestError';
        this.status = status;
        this.body = body;
        this.reason = upstreamCause(body);

        this.withCode(pluginCodeForStatus(status)).withUpstreamStatus(status);

        // The quota hold wins over whatever `Retry-After` advised, including a
        // header that advised nothing: see {@link QUOTA_BACKOFF_MS}.
        const wait = this.quotaExhausted ? QUOTA_BACKOFF_MS : retryAfterMs;
        if (wait !== undefined) this.withRetry(wait);
    }

    /**
     * Whether this is the app's allowance being gone rather than a burst limit.
     *
     * Two different jobs for whoever reads it: a burst clears itself in seconds
     * and needs nothing from anybody, an exhausted quota needs someone to look at
     * the app's allowance in Spotify's dashboard. They arrive as the same status,
     * so the status alone cannot tell an operator which one they have.
     */
    get quotaExhausted(): boolean {
        return this.status === 429 && this.reason === QUOTA_EXCEEDED_REASON;
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
        //
        // A quota 429 says so in words, because its `message` is the same
        // "API rate limit exceeded" a burst limit sends and the two need
        // different things done about them.
        const quota = response.status === 429 && upstreamCause(body) === QUOTA_EXCEEDED_REASON;
        const parts = [
            `HTTP ${response.status}`,
            response.statusText,
            upstreamReason(body),
            quota ? "(quota exhausted: the app's allowance is spent, not a burst limit)" : undefined,
            // WHICH call, because a plugin method can make several and Spotify refuses them
            // individually. A browse that failed reported "HTTP 403 Forbidden" and nothing else,
            // and telling a restricted endpoint apart from a missing scope started with guessing
            // which of three requests had been refused. The path alone: the query string is the
            // caller's own search terms and belongs in the caller's own log line, not in an error.
            endpointOf(response.url),
        ];

        throw new SpotifyRequestError(
            response.status,
            `Spotify API request failed: ${parts.filter(part => part).join(' ')}`,
            body,
            retryAfterMs(response.headers.get('retry-after')),
        );
    }
}
