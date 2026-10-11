import {
    configBaseUrl,
    PluginError,
    jsonBody,
    pluginCodeForStatus as sharedCodeForStatus,
    upstreamDetail,
    type PluginErrorCode,
    type PluginHost,
} from '@deadair/plugin-sdk';

import { CLIENT_IDENTIFIER, PLUGIN_VERSION, PRODUCT, REQUEST_TIMEOUT_MS } from './plex.manifest.js';
import type { PlexContainer } from './plex.types.js';

/** Query parameters as callers write them. `undefined` entries are dropped rather than sent empty. */
export type PlexParams = Record<string, string | number | undefined>;

/**
 * HTTP failures in the host's vocabulary. 401 is `config` rather than `auth`:
 * the token is one the operator pasted into the settings form, so the form is
 * where the fix is.
 */
function pluginCodeForStatus(status: number): PluginErrorCode {
    if (status === 401 || status === 403) return 'config';
    return sharedCodeForStatus(status);
}

/** A Plex call that failed, carrying the status so callers can treat a miss as data. */
export class PlexRequestError extends PluginError {
    readonly status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = 'PlexRequestError';
        this.status = status;
        this.withCode(pluginCodeForStatus(status)).withUpstreamStatus(status);
    }
}

/**
 * Every Plex request this plugin makes, and every URL it hands out.
 *
 * A request this plugin makes sends the token in the `X-Plex-Token` header. A
 * URL handed to somebody else — the file Liquidsoap downloads with no headers of
 * ours, a picture the art cache fetches — can only carry it in the query
 * string, under the same name, which Plex reads from either place.
 */
export class PlexClient {
    readonly baseUrl: string;

    constructor(
        private readonly host: PluginHost,
        baseUrl: string,
        private readonly token: string,
    ) {
        this.baseUrl = configBaseUrl(baseUrl);
    }

    /** A URL for one server path with the token in its query string, for a fetcher that sends no headers. */
    signedUrl(path: string): string {
        const url = new URL(`${this.baseUrl}${path}`);
        url.searchParams.set('X-Plex-Token', this.token);
        return url.toString();
    }

    /**
     * One authenticated GET, parsed.
     *
     * @throws {PlexRequestError} on any non-2xx.
     * @throws {PluginError} with code `upstream` on a 2xx that is not JSON: a
     *   reverse proxy's login page, or a server URL pointing at something that is
     *   not Plex.
     */
    async get(path: string, params: PlexParams = {}): Promise<NonNullable<PlexContainer['MediaContainer']>> {
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined) query.set(key, String(value));
        }
        const search = query.toString();

        const response = await this.host.fetch(`${this.baseUrl}${path}${search ? `?${search}` : ''}`, {
            method: 'GET',
            headers: {
                accept: 'application/json',
                'x-plex-token': this.token,
                'x-plex-client-identifier': CLIENT_IDENTIFIER,
                'x-plex-product': PRODUCT,
                'x-plex-version': PLUGIN_VERSION,
            },
            timeoutMs: REQUEST_TIMEOUT_MS,
        });

        if (!response.ok) {
            await response.body?.cancel();
            const detail = upstreamDetail(response.status, response.statusText);
            throw new PlexRequestError(`Plex request failed: ${detail}`, response.status);
        }

        let body: PlexContainer;
        try {
            body = await jsonBody<PlexContainer>(response);
        } catch {
            throw new PluginError('Plex answered something that is not JSON; check the server URL').withCode('upstream');
        }
        return body.MediaContainer ?? {};
    }
}

/** Whether an error is Plex saying that an id names nothing. */
export const isMissing = (error: unknown): boolean => error instanceof PlexRequestError && error.status === 404;
