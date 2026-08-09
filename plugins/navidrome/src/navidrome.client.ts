import { PluginError, jsonBody, type PluginErrorCode, type PluginHost } from '@deadair/plugin-sdk';

import type { SubsonicAuth } from './navidrome.auth.js';
import { REQUEST_TIMEOUT_MS } from './navidrome.manifest.js';
import type { SubsonicEnvelope, SubsonicError, SubsonicResponseBody } from './navidrome.types.js';

/** Query parameters as callers write them. `undefined` entries are dropped rather than sent empty. */
export type SubsonicParams = Record<string, string | number | undefined>;

/**
 * Subsonic's numeric error codes, in the host's vocabulary.
 *
 * The two credential codes are `config` rather than `forbidden`: they mean the
 * operator typed something wrong in the settings form, and that is the sentence
 * worth putting in front of them. 70 is left as `not_found` for callers to
 * catch, because "no such song" is data — `getTrack` answers `undefined` — and
 * not a failure.
 */
function pluginCodeForSubsonic(code: number | undefined): PluginErrorCode {
    switch (code) {
        case 40:
        case 41:
        case 50:
            return 'config';
        case 70:
            return 'not_found';
        case 60:
            return 'unavailable';
        default:
            return 'upstream';
    }
}

/** HTTP failures, which are the ones Subsonic never got to answer. */
function pluginCodeForStatus(status: number): PluginErrorCode {
    if (status === 401 || status === 403) return 'config';
    if (status === 404) return 'not_found';
    if (status === 429) return 'rate_limited';
    if (status >= 500) return 'unavailable';
    return 'upstream';
}

/** An upstream's sentence, truncated: it ends up in a log line and on a settings card. */
const reason = (message: string | undefined): string | undefined => {
    if (!message) return undefined;
    return message.length > 200 ? `${message.slice(0, 200)}…` : message;
};

/**
 * A Subsonic call that failed, either at the HTTP layer or inside the envelope.
 *
 * Carries `code` so this plugin can branch on it — a 70 from `getSong` means
 * "no such song" and becomes `undefined` rather than an error — while the
 * `PluginError` half says what the host should make of it.
 */
export class SubsonicRequestError extends PluginError {
    /**
     * Subsonic's own numeric code, absent when the request failed before the
     * envelope.
     *
     * Deliberately not `code`: that name belongs to `PluginError` and holds the
     * host's vocabulary, so a subclass writing a number into it would silently
     * overwrite the classification it had just set.
     */
    readonly subsonicCode?: number;

    /** HTTP status, absent when the failure was inside a 200. */
    readonly status?: number;

    constructor(message: string, options: { code?: number; status?: number } = {}) {
        super(message);
        this.name = 'SubsonicRequestError';
        this.subsonicCode = options.code;
        this.status = options.status;

        this.withCode(options.status === undefined ? pluginCodeForSubsonic(options.code) : pluginCodeForStatus(options.status));
        if (options.status !== undefined) this.withUpstreamStatus(options.status);
    }
}

/**
 * Every Subsonic request this plugin makes, and every URL it hands out.
 *
 * Thin on purpose. Rate limiting is declared on the manifest's network entry and
 * applied by `host.fetch`, so there is no queue or timer here; what is left is
 * building a URL, and turning the two ways a Subsonic call can fail into one
 * kind of error.
 *
 * The failure that catches people out is the second one: Subsonic reports
 * `getSong` on a deleted id, or a wrong password, as an HTTP **200** whose body
 * says `status: "failed"`. Anything that only checked `response.ok` would read
 * that as a successful call returning nothing.
 */
export class SubsonicClient {
    private readonly baseUrl: string;

    constructor(
        private readonly host: PluginHost,
        baseUrl: string,
        private readonly auth: SubsonicAuth,
    ) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
    }

    /**
     * A URL for one Subsonic endpoint, with credentials.
     *
     * `stable` picks the salt: see {@link SubsonicAuth}. Public because the URLs
     * this plugin does *not* fetch — the stream Liquidsoap downloads, the cover
     * art the console renders — are built here too, so there is one place that
     * knows how a Subsonic URL is shaped.
     */
    url(endpoint: string, params: SubsonicParams = {}, stable = false): string {
        const query = new URLSearchParams({ ...(stable ? this.auth.stableParams() : this.auth.params()) });
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined) query.set(key, String(value));
        }
        return `${this.baseUrl}/rest/${endpoint}?${query.toString()}`;
    }

    /**
     * One Subsonic call, parsed and unwrapped.
     *
     * @throws {SubsonicRequestError} on a non-2xx, on a body that is not a
     *   Subsonic envelope, and on an envelope saying `failed` — including the
     *   code 70 that means "no such thing", which callers that treat a miss as
     *   data catch and turn into `undefined`.
     */
    async get<T>(endpoint: string, params: SubsonicParams = {}): Promise<SubsonicResponseBody & T> {
        const response = await this.host.fetch(this.url(endpoint, params), {
            method: 'GET',
            headers: { accept: 'application/json' },
            timeoutMs: REQUEST_TIMEOUT_MS,
        });

        if (!response.ok) {
            const detail = [`HTTP ${response.status}`, response.statusText].filter(part => part).join(' ');
            throw new SubsonicRequestError(`Navidrome request failed: ${detail}`, { status: response.status });
        }

        const body = (await jsonBody<SubsonicEnvelope<T>>(response))['subsonic-response'];
        if (body === undefined) {
            // A 200 that is not an envelope at all: a reverse proxy's login page, or
            // a `baseUrl` pointing at something that is not a Subsonic server.
            throw new SubsonicRequestError('Navidrome answered something that is not a Subsonic response; check the server URL', { code: 0 });
        }

        if (body.status === 'failed') throw subsonicFailure(body.error);
        return body;
    }
}

/** The envelope's error, as an exception. */
function subsonicFailure(error: SubsonicError | undefined): SubsonicRequestError {
    const detail = reason(error?.message) ?? 'no reason given';
    return new SubsonicRequestError(`Navidrome refused the request: ${detail}`, { code: error?.code });
}

/** Whether an error is Subsonic's "no such thing", which several callers treat as data. */
export const isNotFound = (error: unknown): boolean => error instanceof SubsonicRequestError && error.subsonicCode === 70;
