import {
    configBaseUrl,
    PluginError,
    jsonBody,
    pluginCodeForStatus as sharedCodeForStatus,
    retryAfterMs,
    truncateUpstreamMessage,
    upstreamDetail,
    upstreamField,
    type PluginErrorCode,
    type PluginHost,
} from '@deadair/plugin-sdk';

import { PLUGIN_VERSION, REQUEST_TIMEOUT_MS } from './lrclib.manifest.js';
import type { LrclibErrorResponse, LrclibRecord } from './lrclib.types.js';

/**
 * LRCLIB asks every client to name itself, its version and a link to it. The host would set a
 * generic one on its own; this one is what the service's own guidance asks for.
 */
export const USER_AGENT = `deadair-lrclib/${PLUGIN_VERSION} (https://github.com/robert-dean/deadair)`;

/** A 503 with a `Retry-After` is the service saying it is busy, which is a rate limit in all but name. */
function pluginCodeForStatus(status: number, hasRetryAfter: boolean): PluginErrorCode {
    if (status === 503) return hasRetryAfter ? 'rate_limited' : 'unavailable';
    return sharedCodeForStatus(status);
}

export class LrclibRequestError extends PluginError {
    readonly status: number;

    constructor(status: number, message: string, retryMs?: number) {
        super(message);
        this.name = 'LrclibRequestError';
        this.status = status;
        this.withCode(pluginCodeForStatus(status, retryMs !== undefined)).withUpstreamStatus(status);
        if (retryMs !== undefined) this.withRetry(retryMs);
    }
}

/** The exact question `GET /api/get` is asked. Duration in whole seconds, which is what it keys on. */
export interface LrclibQuery {
    artist: string;
    title: string;
    album?: string;
    durationSeconds: number;
}

/**
 * The one LRCLIB call this plugin makes.
 *
 * The host it was handed is kept for the life of the client, which is what lets a call that was in
 * flight when the operator saved the settings finish without reaching for a host that has gone.
 */
export class LrclibClient {
    private readonly baseUrl: string;

    constructor(
        private readonly host: PluginHost,
        baseUrl: string,
    ) {
        this.baseUrl = configBaseUrl(baseUrl);
    }

    /**
     * The record LRCLIB holds under exactly these names and this length, or `undefined` for its 404.
     *
     * Strict on purpose, and the strictness is LRCLIB's own: lowercased exact names, album exact
     * when sent, duration within two seconds. There is no search fallback, because a near miss does
     * not error, it returns somebody else's words with a confident timing.
     *
     * @throws {LrclibRequestError} for anything but a 2xx or a 404. A refusal (401, 403) is LOUD,
     *   because a source that refuses this client and reads as a miss is an empty library nobody is
     *   told about.
     */
    async get(query: LrclibQuery): Promise<LrclibRecord | undefined> {
        const params = new URLSearchParams({ artist_name: query.artist, track_name: query.title, duration: String(query.durationSeconds) });
        if (query.album) params.set('album_name', query.album);

        const response = await this.host.fetch(`${this.baseUrl}/api/get?${params.toString()}`, {
            method: 'GET',
            headers: { accept: 'application/json', 'user-agent': USER_AGENT },
            timeoutMs: REQUEST_TIMEOUT_MS,
        });

        if (response.status === 404) {
            await response.body?.cancel().catch(() => {});
            return undefined;
        }

        if (!response.ok) {
            const retryMs = retryAfterMs(response.headers.get('retry-after'));
            const reason = upstreamField(await response.text(), parsed => (parsed as LrclibErrorResponse).message);
            const detail = upstreamDetail(response.status, response.statusText, reason === undefined ? undefined : truncateUpstreamMessage(reason));
            throw new LrclibRequestError(response.status, `LRCLIB request failed: ${detail}`, retryMs);
        }

        return await jsonBody<LrclibRecord>(response);
    }
}
