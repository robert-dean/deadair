import {
    configBaseUrl,
    PluginError,
    jsonBody,
    pluginCodeForStatus as sharedCodeForStatus,
    upstreamDetail,
    type PluginErrorCode,
    type PluginHost,
    UpstreamRequestError,
} from '@deadair/plugin-sdk';

import { CLIENT_NAME, DEVICE_ID, REQUEST_TIMEOUT_MS } from './mediabrowser.config.js';
import type { MediaBrowserDialect } from './mediabrowser.dialect.js';

/** Query parameters as callers write them. `undefined` entries are dropped rather than sent empty. */
export type MediaBrowserParams = Record<string, string | number | undefined>;

/**
 * HTTP failures in the host's vocabulary.
 *
 * 401 is `config` rather than `auth`: the key is one the operator pasted into the settings form, so
 * the form is where the fix is. The server answers a malformed id with a bare 400 rather than a 404,
 * which is why callers asking about an id they stored check {@link isMissing} instead of the code alone.
 */
function pluginCodeForStatus(status: number): PluginErrorCode {
    if (status === 401 || status === 403) return 'config';
    return sharedCodeForStatus(status);
}

/** A call that failed, carrying the status so callers can treat a miss as data. */
export class MediaBrowserRequestError extends UpstreamRequestError {
    constructor(message: string, status: number) {
        super(status, message, { code: pluginCodeForStatus(status) });
        this.name = 'MediaBrowserRequestError';
    }
}

/**
 * Every request a plugin makes, and every URL it hands out.
 *
 * Thin on purpose. Rate limiting is declared on the manifest's network entry and applied by
 * `host.fetch`, so what is left is building a URL and carrying the key.
 *
 * Two ways of carrying it, for two kinds of caller. A request the plugin makes sends the key in the
 * `Authorization` header, the form the servers document and the one that keeps it out of any access
 * log. A URL handed to somebody else (the stream Liquidsoap downloads with no headers of ours) can only
 * carry it in the query string, under the parameter name the dialect says this server reads.
 */
export class MediaBrowserClient {
    readonly baseUrl: string;

    constructor(
        private readonly host: PluginHost,
        baseUrl: string,
        private readonly apiKey: string,
        private readonly dialect: MediaBrowserDialect,
    ) {
        this.baseUrl = configBaseUrl(baseUrl);
    }

    /** A URL for one path, with the key in the query string, for a fetcher that sends no headers. */
    signedUrl(path: string, params: MediaBrowserParams = {}): string {
        return this.url(path, { ...params, [this.dialect.keyParam]: this.apiKey });
    }

    /** A URL for one path with no credentials, for the endpoints the server serves to anybody (images). */
    url(path: string, params: MediaBrowserParams = {}): string {
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined) query.set(key, String(value));
        }
        const search = query.toString();
        return `${this.baseUrl}${path}${search ? `?${search}` : ''}`;
    }

    /**
     * One authenticated GET, parsed.
     *
     * @throws {MediaBrowserRequestError} on any non-2xx.
     * @throws {PluginError} with code `upstream` on a 2xx that is not JSON: a reverse proxy's login
     *   page, or a server URL pointing at something that is not this server.
     */
    async get<T>(path: string, params: MediaBrowserParams = {}): Promise<T> {
        const { product } = this.dialect;
        const response = await this.host.fetch(this.url(path, params), {
            method: 'GET',
            headers: { accept: 'application/json', authorization: this.authorization() },
            timeoutMs: REQUEST_TIMEOUT_MS,
        });

        if (!response.ok) {
            await response.body?.cancel();
            const detail = upstreamDetail(response.status, response.statusText);
            throw new MediaBrowserRequestError(`${product} request failed: ${detail}`, response.status);
        }

        try {
            return await jsonBody<T>(response);
        } catch {
            throw new PluginError(`${product} answered something that is not JSON; check the server URL`).withCode('upstream');
        }
    }

    /** The `MediaBrowser` authorization header the server reads a client and its token from. */
    private authorization(): string {
        return `MediaBrowser Client="${CLIENT_NAME}", Device="${CLIENT_NAME}", DeviceId="${DEVICE_ID}", Version="${this.dialect.version}", Token="${this.apiKey}"`;
    }
}

/**
 * Whether an error is the server saying that an id names nothing.
 *
 * A 404 for a well-formed id the server does not hold, and a bare 400 for one it cannot parse or that
 * names something of the wrong kind (an album's id handed to the playlist endpoint). Both are answers
 * about the id, not failures of the server.
 */
export const isMissing = (error: unknown): boolean => error instanceof MediaBrowserRequestError && (error.status === 404 || error.status === 400);
