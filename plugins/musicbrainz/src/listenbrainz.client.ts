import { PluginError, jsonBody, type PluginErrorCode, type PluginHost } from '@deadair/plugin-sdk';

import { LISTENBRAINZ_ORIGIN, PLUGIN_VERSION, REQUEST_TIMEOUT_MS } from './musicbrainz.manifest.js';
import type { ListenBrainzLookupQuery, ListenBrainzLookupResult, ListenBrainzRecordingMetadataResponse } from './listenbrainz.types.js';

/**
 * The most recordings the lookup endpoint takes in one POST. The service's own
 * published maximum; asking for more is a 400 rather than a truncation.
 */
export const LOOKUP_BATCH_SIZE = 50;

/**
 * The most recording ids the metadata endpoint takes in one POST.
 *
 * The same figure as the lookup's, deliberately, so the two steps of the fast
 * path chunk identically and one lookup's answer is exactly one metadata
 * request's question.
 */
export const METADATA_BATCH_SIZE = 50;

/**
 * How ListenBrainz's statuses read in the host's vocabulary.
 *
 * 401 is `config` rather than `auth`: the only credential here is a token an
 * operator pasted in, so a rejected one is a settings problem they can fix, and
 * saying so beats a generic authentication failure they cannot act on.
 */
function pluginCodeForStatus(status: number): PluginErrorCode {
    if (status === 400) return 'config';
    if (status === 401 || status === 403) return 'config';
    if (status === 404) return 'not_found';
    if (status === 429) return 'rate_limited';
    if (status >= 500) return 'unavailable';
    return 'upstream';
}

/** A non-2xx from ListenBrainz, carrying the status so the caller can branch on it. */
export class ListenBrainzRequestError extends PluginError {
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = 'ListenBrainzRequestError';
        this.status = status;
        this.withCode(pluginCodeForStatus(status)).withUpstreamStatus(status);
    }
}

/**
 * The ListenBrainz half of this plugin: the same organisation's data, over
 * endpoints that answer about a whole batch at once.
 *
 * Two requests here replace what would be fifty on the MusicBrainz web service,
 * which is the entire reason it exists. Both endpoints are POSTs rather than
 * GETs, because fifty artist/title pairs do not belong in a query string, and
 * because the lookup only accepts a body.
 *
 * Thin, like `MusicBrainzClient`: pacing is declared on the manifest and applied
 * by `host.fetch`, so there is no queue or timer here. The service reports its
 * remaining budget in `X-RateLimit-*` headers, which are logged rather than
 * enforced — a second limiter on this side would only be able to disagree with
 * the one already pacing the bucket.
 */
export class ListenBrainzClient {
    private readonly userAgent: string;

    constructor(
        private readonly host: PluginHost,
        private readonly token: string,
    ) {
        this.userAgent = `deadair-musicbrainz/${PLUGIN_VERSION}`;
    }

    /**
     * `POST /1/metadata/lookup/`: artist and title in, MusicBrainz ids out, up
     * to {@link LOOKUP_BATCH_SIZE} at a time.
     *
     * The answer is not promised to be one entry per query, in order: a pair
     * nothing matched is simply absent. Callers line results up by the echoed
     * `_arg` fields, never by position.
     */
    async lookup(queries: ListenBrainzLookupQuery[]): Promise<ListenBrainzLookupResult[]> {
        const answer = await this.post<ListenBrainzLookupResult[] | undefined>('1/metadata/lookup/', { recordings: queries });
        return Array.isArray(answer) ? answer : [];
    }

    /**
     * `POST /1/metadata/recording/`: the facts behind a set of recording ids.
     *
     * `inc` is space separated here rather than `+` separated: this is not the
     * MusicBrainz web service and it does not read the same syntax.
     */
    async recordingMetadata(recordingMbids: string[]): Promise<ListenBrainzRecordingMetadataResponse> {
        const answer = await this.post<ListenBrainzRecordingMetadataResponse | undefined>('1/metadata/recording/', {
            recording_mbids: recordingMbids,
            inc: 'artist tag release',
        });
        return answer && typeof answer === 'object' ? answer : {};
    }

    private async post<T>(path: string, payload: unknown): Promise<T> {
        const response = await this.host.fetch(`${LISTENBRAINZ_ORIGIN}/${path}`, {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                authorization: `Token ${this.token}`,
                'user-agent': this.userAgent,
            },
            body: JSON.stringify(payload),
            timeoutMs: REQUEST_TIMEOUT_MS,
        });

        if (!response.ok) {
            throw new ListenBrainzRequestError(response.status, `ListenBrainz request failed: HTTP ${response.status} ${response.statusText}`.trim());
        }

        const remaining = response.headers.get('x-ratelimit-remaining');
        if (remaining !== null) {
            this.host.logger.debug('listenbrainz budget', { remaining, resetIn: response.headers.get('x-ratelimit-reset-in') ?? undefined });
        }

        return await jsonBody<T>(response);
    }
}
