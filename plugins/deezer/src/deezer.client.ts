import {
    PluginError,
    jsonBody,
    pluginCodeForStatus,
    retryAfterMs,
    truncateUpstreamMessage,
    upstreamDetail,
    type PluginHost,
} from '@deadair/plugin-sdk';

import { API_ROOT, PLUGIN_VERSION, REQUEST_TIMEOUT_MS } from './deezer.manifest.js';
import { DEEZER_CODE_NO_DATA, type DeezerErrorResponse } from './deezer.types.js';

/**
 * A failure from Deezer, carrying both the HTTP status and Deezer's own code.
 *
 * Two numbers because the interesting failures here do not arrive as a status:
 * see {@link DeezerClient.get}.
 */
export class DeezerRequestError extends PluginError {
    readonly status: number;
    /** Deezer's own error code, where the failure came back inside a 200. */
    readonly upstreamCode?: number;

    constructor(status: number, message: string, options: { upstreamCode?: number; retryMs?: number } = {}) {
        super(message);
        this.name = 'DeezerRequestError';
        this.status = status;
        if (options.upstreamCode !== undefined) this.upstreamCode = options.upstreamCode;

        this.withCode(pluginCodeForStatus(status)).withUpstreamStatus(status);
        if (options.retryMs !== undefined) this.withRetry(options.retryMs);
    }

    /** Whether this is Deezer's way of saying "nothing here", which is data rather than a fault. */
    get isNoData(): boolean {
        return this.upstreamCode === DEEZER_CODE_NO_DATA;
    }
}

/**
 * Deezer's public catalogue.
 *
 * Thin, like every client in this repo: the pacing is declared on the
 * manifest's network entries and applied by `host.fetch`, which parks each call
 * until there is headroom, so there is no queue or timer here.
 *
 * No key, no signing and no account. That is not a simplification of this
 * client, it is the reason the plugin was written.
 */
export class DeezerClient {
    private readonly userAgent: string;

    constructor(private readonly host: PluginHost) {
        this.userAgent = `deadair-deezer/${PLUGIN_VERSION}`;
    }

    /**
     * One catalogue call, parsed.
     *
     * **Deezer reports most failures with HTTP 200 and an `error` object in the
     * body**, so a client that only checked `response.ok` would hand the
     * mapping an object with no `data` and read it as an empty answer. Both
     * shapes are raised here, which is what lets the caller tell "this artist
     * has no neighbours" (code 800) apart from a quota or an outage.
     *
     * @throws {DeezerRequestError} on a non-2xx, and on a 200 carrying an error
     *   object. An empty `data` array is NOT one of those: it is an ordinary
     *   answer and the callers read it as such.
     */
    async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
        const query = new URLSearchParams(params).toString();
        const url = `${API_ROOT}/${path}${query.length > 0 ? `?${query}` : ''}`;

        const response = await this.host.fetch(url, {
            method: 'GET',
            headers: { accept: 'application/json', 'user-agent': this.userAgent },
            timeoutMs: REQUEST_TIMEOUT_MS,
        });

        if (!response.ok) {
            const retryMs = retryAfterMs(response.headers.get('retry-after'));
            // The body is drained rather than left open: an unread body holds the
            // connection until the host's own idle timeout cuts it.
            const detail = upstreamDetail(response.status, response.statusText, truncateUpstreamMessage(await response.text()));
            throw new DeezerRequestError(response.status, `Deezer request failed: ${detail}`, { ...(retryMs === undefined ? {} : { retryMs }) });
        }

        const parsed = await jsonBody<T & DeezerErrorResponse>(response);
        const error = parsed.error;
        if (error) {
            const reason = truncateUpstreamMessage([error.type, error.message].filter(part => part).join(': '));
            throw new DeezerRequestError(response.status, `Deezer request failed: ${reason || 'unspecified error'}`, {
                ...(error.code === undefined ? {} : { upstreamCode: error.code }),
            });
        }

        return parsed;
    }

    /** The plugin's identifying header, so a test can assert on it without a live request. */
    get identity(): string {
        return this.userAgent;
    }
}
