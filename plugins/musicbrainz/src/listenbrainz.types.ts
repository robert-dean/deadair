/**
 * The parts of the ListenBrainz metadata API this plugin reads.
 *
 * Partial and all-optional for the same reason `musicbrainz.types.ts` is: what
 * comes back depends on the `inc` the request asked for, and a block that was
 * not asked for is absent rather than empty. Field names are ListenBrainz's
 * own, snake_case and all — this is a different service's vocabulary for the
 * same facts, not MusicBrainz WS/2 under another name.
 */

/** One entry in a `POST /1/metadata/lookup/` request. */
export interface ListenBrainzLookupQuery {
    artist_name: string;
    recording_name: string;
    release_name?: string;
}

/**
 * One entry in the lookup's answer.
 *
 * The `_arg` fields echo what was asked, which is the only reliable way to line
 * an answer up with its question: the service does not promise to return one
 * entry per query, in order, and a query it could not resolve is simply absent.
 */
export interface ListenBrainzLookupResult {
    artist_credit_name?: string;
    artist_mbids?: string[];
    recording_mbid?: string;
    recording_name?: string;
    release_mbid?: string;
    release_name?: string;
    artist_name_arg?: string;
    recording_name_arg?: string;
    release_name_arg?: string;
    index?: number;
}

/** A `{ tag, count }` pair, optionally carrying the genre id when the tag is a curated genre. */
export interface ListenBrainzTag {
    tag?: string;
    count?: number;
    genre_mbid?: string;
}

/**
 * One recording's metadata, as `GET|POST /1/metadata/recording/` returns it.
 *
 * `release.year` is the year of the release, not the recording's own first
 * release date, which is a real difference from what a MusicBrainz recording
 * document says. It is the only date this endpoint offers, so it is what the
 * mapping uses, and it is why nothing here sets `releaseDate`: a year is not a
 * date, and inventing `YYYY-01-01` would be a precision the source never had.
 */
export interface ListenBrainzRecordingMetadata {
    recording?: {
        /**
         * The recording's title. Present whenever `inc` asked for nothing that
         * suppresses it, and the reason the similarity capability can turn a
         * radio answer's bare mbids into records a station can schedule.
         */
        name?: string;
        rels?: { artist_name?: string; artist_mbid?: string; type?: string; instrument?: string }[];
    };
    release?: {
        name?: string;
        album_artist_name?: string;
        year?: number;
        mbid?: string;
        release_group_mbid?: string;
        /** Cover Art Archive image id. Its presence is the answer to "is there a cover". */
        caa_id?: number;
        /** The release the cover belongs to, which is not always the release above. */
        caa_release_mbid?: string;
    };
    artist?: {
        name?: string;
        artist_credit_id?: number;
        artists?: { name?: string; artist_mbid?: string; join_phrase?: string }[];
    };
    tag?: {
        recording?: ListenBrainzTag[];
        artist?: ListenBrainzTag[];
        release_group?: ListenBrainzTag[];
    };
}

/** The metadata endpoint answers a map keyed by recording MBID, not an array. */
export type ListenBrainzRecordingMetadataResponse = Record<string, ListenBrainzRecordingMetadata>;

/**
 * One row of the radio endpoint's answer: a recording by an artist who
 * resembles the seed.
 *
 * The row carries the ARTIST's name and the recording's id, and never the
 * recording's title — turning these into records therefore costs a second
 * request to the metadata endpoint, which is why `similarArtists` (names only)
 * is one request and naming records is two.
 */
export interface ListenBrainzRadioRecording {
    recording_mbid?: string;
    similar_artist_mbid?: string;
    similar_artist_name?: string;
    total_listen_count?: number;
}

/**
 * `GET /1/lb-radio/artist/{mbid}`, keyed by similar-artist MBID.
 *
 * The seed artist is one of the keys: the endpoint builds a radio station about
 * an artist, and such a station plays that artist. Every caller here drops
 * them, because the host asked who ELSE sounds like this.
 */
export type ListenBrainzRadioResponse = Record<string, ListenBrainzRadioRecording[]>;

/**
 * One row of `GET /1/popularity/top-recordings-for-artist/{mbid}`, already
 * ordered by listen count.
 *
 * Field names checked against `listenbrainz/webserver/views/popularity_api.py`
 * rather than guessed. `artist_name` is deliberately NOT read: it is the
 * artist CREDIT for the recording, so a featured spot would arrive as a joined
 * line, and everything downstream matches a record on its lead artist alone.
 * The lead comes from the metadata endpoint, as it does on the radio path.
 */
export interface ListenBrainzTopRecording {
    recording_mbid?: string;
    recording_name?: string;
    artist_name?: string;
    artist_mbids?: string[];
    release_name?: string;
    total_listen_count?: number;
}

/**
 * One row of `GET labs.api.listenbrainz.org/similar-recordings/json`.
 *
 * `reference_mbid` echoes the recording that was asked about, which is how a
 * row about the seed itself is told from a row about something else.
 *
 * `artist_credit_name` is a CREDIT and `artist_credit_mbids` came back null on
 * every row measured, so neither can give the lead artist. It comes from the
 * metadata endpoint instead.
 */
export interface ListenBrainzSimilarRecording {
    recording_mbid?: string;
    recording_name?: string;
    artist_credit_name?: string;
    artist_credit_mbids?: string[] | null;
    release_name?: string;
    reference_mbid?: string;
    /** How alike, on this algorithm's own scale. Rows arrive highest first. */
    score?: number;
}

/**
 * One listen as `POST /1/submit-listens` takes it.
 *
 * `listened_at` is Unix SECONDS, where everything on the host's side is milliseconds, and it is
 * absent for a `playing_now` submission, which the service refuses if it carries one.
 */
export interface ListenBrainzListen {
    listened_at?: number;
    track_metadata: {
        artist_name: string;
        track_name: string;
        release_name?: string;
        additional_info?: {
            duration_ms?: number;
            tracknumber?: number;
            recording_mbid?: string;
            submission_client?: string;
            submission_client_version?: string;
        };
    };
}

/**
 * The body of `POST /1/submit-listens`.
 *
 * `single` is one listen that has happened, `import` several, and `playing_now` one that is
 * happening. The service refuses a `single` or `playing_now` carrying more than one listen.
 */
export interface ListenBrainzSubmission {
    listen_type: 'single' | 'import' | 'playing_now';
    payload: ListenBrainzListen[];
}
