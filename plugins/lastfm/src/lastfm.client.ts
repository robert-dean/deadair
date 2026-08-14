import { createHash } from 'node:crypto';
import {
    jsonBody,
    PluginError,
    pluginCodeForStatus,
    retryAfterMs,
    truncateUpstreamMessage,
    upstreamDetail,
    type PluginErrorCode,
    type PluginHost,
} from '@deadair/plugin-sdk';

import { API_ROOT, PLUGIN_VERSION, REQUEST_TIMEOUT_MS } from './lastfm.manifest.js';
import type { LastfmErrorResponse } from './lastfm.types.js';

/**
 * Every request this plugin makes.
 *
 * Two things about this API are unusual enough to be the whole reason this file
 * exists rather than a `fetch` at each call site.
 *
 * **A failure arrives as HTTP 200.** The service answers `{"error":6,"message":
 * "…"}` with a perfectly good status, so a client that only checks
 * `response.ok` treats every failure as an empty answer — the enrichment walk
 * would store "nothing known" against a track whose lookup was actually refused
 * for a bad key, and would keep doing it. The error code is checked on every
 * response, and it is what decides the `PluginError` code the host sees.
 *
 * **A write is signed.** Anything touching an account takes an `api_sig`: the
 * MD5 of every parameter sorted by name, concatenated as name-then-value with no
 * separators, with the shared secret on the end. `format` is excluded, which is
 * the detail that costs an afternoon if it is missed, because the signature then
 * verifies nowhere and the service simply says the signature is invalid.
 */

/**
 * The service's own error numbers, as far as they mean different things here.
 *
 * The full list is longer; these are the ones where the host would do something
 * different. Anything unlisted is an ordinary upstream failure.
 */
export const LASTFM_ERROR = {
    /** The request was malformed: this plugin's bug, not the operator's. */
    invalidParameters: 6,
    /** Bad API key, or one that has been suspended. */
    invalidApiKey: 10,
    /** The signature did not verify. In practice: the wrong secret, or `format` in the signed set. */
    invalidSignature: 13,
    /** The session key is gone. The operator has to connect the account again. */
    invalidSession: 9,
    /** Authentication failed outright. */
    authenticationFailed: 4,
    /** The service is down for maintenance. */
    serviceOffline: 11,
    /** A transient failure the service asks you to retry. */
    temporaryError: 16,
    /** Too fast. */
    rateLimit: 29,
} as const;

/**
 * How one of those numbers reads in the host's vocabulary.
 *
 * The three `config` cases matter most: a suspended key, a bad secret and a
 * revoked session are all things only the operator can fix, and reporting them
 * as `upstream` would have the host's breaker quarantine the plugin as though
 * the service were down — which hides the one message that would have helped.
 */
function codeForApiError(error: number): PluginErrorCode {
    switch (error) {
        case LASTFM_ERROR.invalidApiKey:
        case LASTFM_ERROR.invalidSignature:
        case LASTFM_ERROR.invalidSession:
        case LASTFM_ERROR.authenticationFailed:
            return 'config';
        case LASTFM_ERROR.invalidParameters:
            return 'internal';
        case LASTFM_ERROR.rateLimit:
            return 'rate_limited';
        case LASTFM_ERROR.serviceOffline:
            return 'unavailable';
        default:
            return 'upstream';
    }
}

/**
 * A refusal from Last.fm, carrying its own error number so this plugin can
 * branch on it — a 6 from a lookup is usually "no such artist" and is data, not
 * a failure — while the `PluginError` half says what the host should make of it.
 */
export class LastfmRequestError extends PluginError {
    /** The service's own error number, or `undefined` when the failure was HTTP-level. */
    readonly apiError?: number;
    readonly status: number;

    constructor(status: number, message: string, options: { apiError?: number; retryMs?: number } = {}) {
        super(message);
        this.name = 'LastfmRequestError';
        this.status = status;
        if (options.apiError !== undefined) this.apiError = options.apiError;

        this.withCode(options.apiError === undefined ? pluginCodeForStatus(status) : codeForApiError(options.apiError));
        if (status !== 200) this.withUpstreamStatus(status);
        if (options.retryMs !== undefined) this.withRetry(options.retryMs);
    }
}

export class LastfmClient {
    private readonly userAgent = `deadair-lastfm/${PLUGIN_VERSION}`;

    constructor(
        private readonly host: PluginHost,
        private readonly apiKey: string,
        private readonly apiSecret?: string,
    ) {}

    /** Whether this client can sign, which is whether it can touch an account at all. */
    get canSign(): boolean {
        return (this.apiSecret ?? '').length > 0;
    }

    /**
     * A read. Unsigned, since none of them touch an account.
     *
     * @throws {LastfmRequestError} on a non-2xx and equally on the HTTP 200 that
     *   carries an error number, which is how this service reports most failures.
     */
    async get<T>(method: string, params: Record<string, string> = {}): Promise<T> {
        const query = new URLSearchParams({ ...params, method, api_key: this.apiKey, format: 'json' });

        const response = await this.host.fetch(`${API_ROOT}?${query.toString()}`, {
            method: 'GET',
            headers: { accept: 'application/json', 'user-agent': this.userAgent },
            timeoutMs: REQUEST_TIMEOUT_MS,
        });

        return await this.read<T>(response, method);
    }

    /**
     * A write: signed, POSTed as a form, and touching the operator's account.
     *
     * The session key is a parameter like any other and is therefore part of the
     * signature, which is what stops a captured request from being replayed with
     * a different track.
     */
    async post<T>(method: string, params: Record<string, string>): Promise<T> {
        if (!this.apiSecret) {
            throw new PluginError('Last.fm needs its API secret before it can write anything').withCode('config');
        }

        const signed = { ...params, method, api_key: this.apiKey };
        const body = new URLSearchParams({ ...signed, api_sig: sign(signed, this.apiSecret), format: 'json' });

        const response = await this.host.fetch(API_ROOT, {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'content-type': 'application/x-www-form-urlencoded',
                'user-agent': this.userAgent,
            },
            body: body.toString(),
            timeoutMs: REQUEST_TIMEOUT_MS,
        });

        return await this.read<T>(response, method);
    }

    /**
     * One response, with both ways it can be a failure checked.
     *
     * The order matters: the HTTP status is checked first because a 5xx has no
     * JSON body to read an error number out of, and the error number second
     * because a 200 is not evidence of anything on this API.
     */
    private async read<T>(response: Response, method: string): Promise<T> {
        if (!response.ok) {
            const retryMs = retryAfterMs(response.headers.get('retry-after'));
            const detail = upstreamDetail(response.status, response.statusText);
            throw new LastfmRequestError(response.status, `Last.fm ${method} failed: ${detail}`, {
                ...(retryMs === undefined ? {} : { retryMs }),
            });
        }

        const parsed = await jsonBody<T & LastfmErrorResponse>(response);

        if (typeof parsed?.error === 'number') {
            // Truncated because an upstream's own sentence reaches a log line and
            // the settings card, and is not this plugin's text.
            const said = truncateUpstreamMessage(parsed.message ?? 'no reason given');
            throw new LastfmRequestError(response.status, `Last.fm ${method} refused the request: ${said} (error ${parsed.error})`, {
                apiError: parsed.error,
            });
        }

        return parsed;
    }
}

/**
 * The `api_sig` for a set of parameters.
 *
 * Sorted by name, concatenated as name-then-value with nothing between them,
 * the shared secret appended, MD5'd. Exported because it is the one piece of
 * this plugin that is pure, fiddly and impossible to debug from a live response:
 * the service's only feedback on a wrong signature is "invalid signature".
 *
 * **`format` and `api_sig` are excluded**, which is not an optimisation. Signing
 * `format=json` produces a signature that verifies nowhere, and the symptom is
 * indistinguishable from having the wrong secret.
 */
export function sign(params: Record<string, string>, secret: string): string {
    const payload = Object.keys(params)
        .filter(key => key !== 'format' && key !== 'api_sig')
        .sort()
        .map(key => `${key}${params[key]}`)
        .join('');

    return createHash('md5').update(`${payload}${secret}`, 'utf8').digest('hex');
}
