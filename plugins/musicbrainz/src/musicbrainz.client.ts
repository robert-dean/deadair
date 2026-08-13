import {
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

import { PLUGIN_VERSION, REQUEST_TIMEOUT_MS } from './musicbrainz.manifest.js';
import type { MusicBrainzErrorResponse } from './musicbrainz.types.js';

/**
 * How MusicBrainz's statuses read in the host's vocabulary.
 *
 * 503 is the interesting one: MusicBrainz uses it for "you are going too fast"
 * as well as for real downtime, and tells them apart with a `Retry-After`. The
 * caller does the same thing either way (back off), but the codes mean
 * different things to the host's circuit breaker, so the distinction is made
 * where the header can still be seen rather than guessed at later.
 *
 * 400 is `config` rather than `upstream`: the only way to get one out of a
 * read-only web service is a query this plugin built wrong or a `baseUrl` that
 * is not a MusicBrainz server at all, and the second is the one an operator
 * can act on.
 */
function pluginCodeForStatus(status: number, hasRetryAfter: boolean): PluginErrorCode {
    if (status === 400) return 'config';
    if (status === 503) return hasRetryAfter ? 'rate_limited' : 'unavailable';
    return sharedCodeForStatus(status);
}

/**
 * MusicBrainz's own sentence for the failure, out of `{"error":"…","help":"…"}`.
 *
 * Truncated, because an upstream body is untrusted text that ends up in a log
 * line and on the settings card.
 */
function upstreamReason(body: string): string | undefined {
    const message = upstreamField(body, parsed => (parsed as MusicBrainzErrorResponse).error);
    return message === undefined ? undefined : truncateUpstreamMessage(message);
}

/**
 * A non-2xx from MusicBrainz, carrying the numeric status so this plugin can
 * branch on it (a 404 from a lookup is "no such recording", not a failure)
 * while the `PluginError` half says what the host should make of it.
 */
export class MusicBrainzRequestError extends PluginError {
    readonly status: number;

    constructor(status: number, message: string, retryMs?: number) {
        super(message);
        this.name = 'MusicBrainzRequestError';
        this.status = status;

        this.withCode(pluginCodeForStatus(status, retryMs !== undefined)).withUpstreamStatus(status);
        if (retryMs !== undefined) this.withRetry(retryMs);
    }
}

/**
 * Every MusicBrainz request this plugin makes.
 *
 * Thin on purpose: the pacing MusicBrainz asks for is declared on the
 * manifest's network entries and applied by `host.fetch`, which parks each
 * call until there is headroom, so there is no queue or timer here. What is
 * left is the URL, the two headers, and turning a status into something the
 * host understands.
 *
 * The `User-Agent` is ours rather than the host's default, because
 * MusicBrainz's policy wants a contact address and refuses clients that do not
 * identify themselves. The host leaves a header the plugin already set alone.
 */
export class MusicBrainzClient {
    private readonly userAgent: string;
    private readonly baseUrl: string;

    constructor(
        private readonly host: PluginHost,
        baseUrl: string,
        contactEmail: string,
    ) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.userAgent = `deadair-musicbrainz/${PLUGIN_VERSION} ( mailto:${contactEmail} )`;
    }

    /**
     * One WS/2 lookup or search, parsed.
     *
     * `fmt=json` is forced rather than left to the caller: the XML the service
     * defaults to is not something anything downstream can read.
     *
     * @throws {MusicBrainzRequestError} on any non-2xx, including the 404 that
     *   means "no such entity". Callers that treat a miss as data catch it.
     */
    async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
        const query = new URLSearchParams({ ...params, fmt: 'json' });
        const url = `${this.baseUrl}/${path}?${query.toString()}`;

        const response = await this.host.fetch(url, {
            method: 'GET',
            headers: { accept: 'application/json', 'user-agent': this.userAgent },
            timeoutMs: REQUEST_TIMEOUT_MS,
        });

        if (!response.ok) {
            const retryMs = retryAfterMs(response.headers.get('retry-after'));
            const detail = upstreamDetail(response.status, response.statusText, upstreamReason(await response.text()));
            throw new MusicBrainzRequestError(response.status, `MusicBrainz request failed: ${detail}`, retryMs);
        }

        return await jsonBody<T>(response);
    }

    /** The plugin's identifying header, so a test can assert on it without a live request. */
    get identity(): string {
        return this.userAgent;
    }
}
