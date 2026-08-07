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
