import {
    PluginError,
    jsonBody,
    pluginCodeForStatus,
    retryAfterMs,
    truncateUpstreamMessage,
    upstreamDetail,
    upstreamField,
    type PluginHost,
} from '@deadair/plugin-sdk';

import { PLUGIN_VERSION, REQUEST_TIMEOUT_MS } from './wikipedia.manifest.js';
import type { MediaWikiErrorResponse } from './wikipedia.types.js';

/**
 * MediaWiki's own sentence for the failure, out of `{"error":{"code":…,"info":…}}`.
 *
 * Truncated, because an upstream body is untrusted text that ends up in a log
 * line and on the settings card.
 */
function upstreamReason(body: string): string | undefined {
    const message = upstreamField(body, parsed => (parsed as MediaWikiErrorResponse).error?.info);
    return message === undefined ? undefined : truncateUpstreamMessage(message);
}

/**
 * A non-2xx from a MediaWiki API, carrying the numeric status so this plugin
 * can branch on it while the `PluginError` half says what the host should make
 * of it.
 */
export class MediaWikiRequestError extends PluginError {
    readonly status: number;

    constructor(status: number, message: string, retryMs?: number) {
        super(message);
        this.name = 'MediaWikiRequestError';
        this.status = status;

        this.withCode(pluginCodeForStatus(status)).withUpstreamStatus(status);
        if (retryMs !== undefined) this.withRetry(retryMs);
    }
}

/**
 * One MediaWiki action API, which is the same API whether it is answering for
 * Wikidata or for an edition of Wikipedia. Two instances, one class.
 *
 * Thin, like every client in this repo: the pacing is declared on the
 * manifest's network entries and applied by `host.fetch`, which parks each call
 * until there is headroom, so there is no queue or timer here.
 *
 * Two things are not left to the caller. `format=json` and `formatversion=2`
 * are forced, because the legacy format answers with objects keyed by page id
 * where version 2 answers with arrays, and half of the parsing below would be
 * about which one arrived. And the `User-Agent` is ours rather than the host's
 * default, because Wikimedia's policy asks every client to identify itself with
 * a contact address and blocks ones that do not; the host leaves a header the
 * plugin already set alone.
 */
export class MediaWikiClient {
    private readonly userAgent: string;

    constructor(
        private readonly host: PluginHost,
        private readonly endpoint: string,
        contactEmail: string,
    ) {
        this.userAgent = `deadair-wikipedia/${PLUGIN_VERSION} (mailto:${contactEmail})`;
    }

    /**
     * One action API call, parsed.
     *
     * @throws {MediaWikiRequestError} on any non-2xx. An empty result is NOT
     *   one of those: the API answers 200 with an empty `search` array or a
     *   `missing` page, which is data and is read as such by the callers.
     */
    async get<T>(params: Record<string, string>): Promise<T> {
        const query = new URLSearchParams({ ...params, format: 'json', formatversion: '2' });
        const url = `${this.endpoint}?${query.toString()}`;

        const response = await this.host.fetch(url, {
            method: 'GET',
            headers: { accept: 'application/json', 'user-agent': this.userAgent },
            timeoutMs: REQUEST_TIMEOUT_MS,
        });

        if (!response.ok) {
            const retryMs = retryAfterMs(response.headers.get('retry-after'));
            const detail = upstreamDetail(response.status, response.statusText, upstreamReason(await response.text()));
            throw new MediaWikiRequestError(response.status, `Wikimedia request failed: ${detail}`, retryMs);
        }

        return await jsonBody<T>(response);
    }

    /** The plugin's identifying header, so a test can assert on it without a live request. */
    get identity(): string {
        return this.userAgent;
    }
}
