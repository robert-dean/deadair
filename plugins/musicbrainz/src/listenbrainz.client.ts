import { PluginError, jsonBody, pluginCodeForStatus as sharedCodeForStatus, type PluginErrorCode, type PluginHost } from '@deadair/plugin-sdk';

import { LISTENBRAINZ_LABS_ORIGIN, LISTENBRAINZ_ORIGIN, PLUGIN_VERSION, REQUEST_TIMEOUT_MS } from './musicbrainz.manifest.js';
import type {
    ListenBrainzLookupQuery,
    ListenBrainzLookupResult,
    ListenBrainzRadioResponse,
    ListenBrainzRecordingMetadataResponse,
    ListenBrainzSimilarRecording,
    ListenBrainzSubmission,
    ListenBrainzTopRecording,
} from './listenbrainz.types.js';

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
 * Which similarity dataset `similar-recordings` is asked for.
 *
 * An exact enum the service owns, not a set of parameters: a plausible guess
 * during this work was refused with a 400 naming the values that exist. If this
 * one is retired, the endpoint 400s, {@link MusicBrainzPlugin.similarTracks}
 * answers empty and the host falls back to walking the anchor's artist — so the
 * failure costs the closer answer and nothing else.
 */
export const SIMILAR_RECORDINGS_ALGORITHM = 'session_based_days_7500_session_300_contribution_5_threshold_15_limit_50_skip_30';

/**
 * How ListenBrainz's statuses read in the host's vocabulary.
 *
 * 401 is `config` rather than `auth`: the only credential here is a token an
 * operator pasted in, so a rejected one is a settings problem they can fix, and
 * saying so beats a generic authentication failure they cannot act on.
 */
function pluginCodeForStatus(status: number): PluginErrorCode {
    if (status === 400 || status === 401 || status === 403) return 'config';
    return sharedCodeForStatus(status);
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

    /**
     * The token is OPTIONAL, and which endpoints that rules out is the thing to
     * know before using this.
     *
     * The batching endpoints (`lookup`, and therefore the whole enrichment fast
     * path) refuse an anonymous caller with a 401. The radio endpoint below does
     * not, today. ListenBrainz has been closing endpoints to anonymous callers —
     * `/1/metadata/lookup/` and `/1/popularity/top-recordings-for-artist/` both
     * answer 401 with a sentence about scrapers — so this is a line that moves,
     * and every caller here treats a 401 as an ordinary empty answer rather than
     * a fault.
     */
    constructor(
        private readonly host: PluginHost,
        private readonly token?: string,
    ) {
        this.userAgent = `deadair-musicbrainz/${PLUGIN_VERSION}`;
    }

    /** Whether this client can reach the endpoints that require a token. */
    get authenticated(): boolean {
        return (this.token ?? '').length > 0;
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

    /**
     * `GET /1/lb-radio/artist/{mbid}`: an artist in, the artists ListenBrainz
     * says resemble them out, with a recording or two by each.
     *
     * Open to anonymous callers today, which is the whole reason the similarity
     * capability can be offered to an operator who has pasted in no token.
     *
     * The answer is keyed by similar-artist mbid and **includes the seed artist
     * among the keys**, which is a property of the endpoint rather than a
     * mistake: it is built to fill a radio station, and a station about an
     * artist plays that artist. Callers drop them.
     *
     * `mode` widens the net: `easy` stays close to the seed, `medium` and `hard`
     * reach further out and into less popular records.
     *
     * **All five parameters are MANDATORY**, which the documentation does not
     * say and the service enforces one at a time: leaving off `pop_begin` is a
     * 400 reading `pop_begin param is missing`, and leaving off
     * `max_recordings_per_artist` is a different 400 naming that one. So they
     * are defaulted here rather than being optional on the wire, and the
     * defaults are this client's, not the service's — it has none.
     */
    async radioForArtist(
        artistMbid: string,
        options: {
            mode?: 'easy' | 'medium' | 'hard';
            maxSimilarArtists?: number;
            maxRecordingsPerArtist?: number;
            popBegin?: number;
            popEnd?: number;
        } = {},
    ): Promise<ListenBrainzRadioResponse> {
        const answer = await this.get<ListenBrainzRadioResponse | undefined>(`1/lb-radio/artist/${encodeURIComponent(artistMbid)}`, {
            mode: options.mode ?? 'easy',
            max_similar_artists: String(options.maxSimilarArtists ?? 10),
            max_recordings_per_artist: String(options.maxRecordingsPerArtist ?? 1),
            pop_begin: String(options.popBegin ?? 0),
            pop_end: String(options.popEnd ?? 100),
        });
        return answer && typeof answer === 'object' ? answer : {};
    }

    /**
     * `GET /1/popularity/top-recordings-for-artist/{mbid}`: an artist's records,
     * most listened first.
     *
     * **Needs a token.** The service calls this an expensive endpoint and
     * answers an anonymous caller 401 with a sentence about scrapers. There is
     * no open substitute: the radio endpoint samples a catalogue for variety
     * and returns B-sides, live cuts and mashups as readily as the record
     * somebody would recognise, which is right for the station it is named
     * after and wrong for this question.
     *
     * Already ordered, so callers take the front of the list rather than
     * sorting it.
     */
    async topRecordingsForArtist(artistMbid: string): Promise<ListenBrainzTopRecording[]> {
        const answer = await this.get<ListenBrainzTopRecording[] | undefined>(
            `1/popularity/top-recordings-for-artist/${encodeURIComponent(artistMbid)}`,
        );
        return Array.isArray(answer) ? answer : [];
    }

    /**
     * `GET labs.api.listenbrainz.org/similar-recordings/json`: records that
     * people listen to alongside this one.
     *
     * Open to anonymous callers, and the only keyless record-level answer there
     * is — Deezer has no such endpoint at all.
     *
     * **`algorithm` is an exact enum the service owns and changes.** It is not
     * a set of knobs: a plausible-looking value is a 400 listing the ones that
     * exist. So {@link SIMILAR_RECORDINGS_ALGORITHM} is one constant, and a 400
     * is reported by the caller as "no answer" rather than allowed to count
     * against the plugin — a retired enum should cost the record-level answer
     * and nothing else.
     *
     * Rows arrive highest score first, so callers keep the order.
     */
    async similarRecordings(recordingMbid: string): Promise<ListenBrainzSimilarRecording[]> {
        const answer = await this.getFrom<ListenBrainzSimilarRecording[] | undefined>(LISTENBRAINZ_LABS_ORIGIN, 'similar-recordings/json', {
            recording_mbids: recordingMbid,
            algorithm: SIMILAR_RECORDINGS_ALGORITHM,
        });
        return Array.isArray(answer) ? answer : [];
    }

    /**
     * `POST /1/submit-listens`: report listens to the account the token belongs to.
     *
     * The one WRITE this client makes, and the one call here that needs the token by definition
     * rather than for speed. The service answers a whole payload at once: a 400 refuses every
     * listen in it without saying which, so a caller that wants to know has to ask again one at a
     * time.
     */
    async submitListens(submission: ListenBrainzSubmission): Promise<void> {
        await this.post<unknown>('1/submit-listens', submission);
    }

    private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
        return await this.getFrom<T>(LISTENBRAINZ_ORIGIN, path, params);
    }

    private async getFrom<T>(origin: string, path: string, params: Record<string, string> = {}): Promise<T> {
        const query = new URLSearchParams(params).toString();
        return await this.send<T>(origin, `${path}${query.length > 0 ? `?${query}` : ''}`, { method: 'GET' });
    }

    private async post<T>(path: string, payload: unknown): Promise<T> {
        return await this.send<T>(LISTENBRAINZ_ORIGIN, path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
        });
    }

    private async send<T>(
        origin: string,
        path: string,
        init: { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: string },
    ): Promise<T> {
        const response = await this.host.fetch(`${origin}/${path}`, {
            method: init.method,
            headers: {
                accept: 'application/json',
                ...init.headers,
                // Sent only when there is one. An anonymous caller gets the open
                // endpoints; `Token ` with nothing after it is a 401 on all of them.
                ...(this.authenticated ? { authorization: `Token ${this.token}` } : {}),
                'user-agent': this.userAgent,
            },
            ...(init.body === undefined ? {} : { body: init.body }),
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
