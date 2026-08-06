/**
 * The parts of MusicBrainz WS/2 this plugin actually reads.
 *
 * Hand-written rather than generated, and deliberately partial: every field is
 * optional because what comes back depends on the `inc` parameters of the
 * request that asked for it, and a lookup that omits an `inc` returns the
 * entity without that block rather than with an empty one. Treating the whole
 * document as "might not be there" is the honest shape, and it keeps the
 * mapping code doing the checking in one place.
 *
 * Field names are MusicBrainz's own, hyphens and all.
 */

/** A `{ name, count }` pair. `genres` and `tags` are the same shape; only the vocabulary differs. */
export interface MusicBrainzTag {
    name?: string;
    count?: number;
}

export interface MusicBrainzArtistRef {
    id?: string;
    name?: string;
    'sort-name'?: string;
    disambiguation?: string;
}

/**
 * One name in a credit. `name` is how this artist was credited on this
 * release, which is not always their canonical `artist.name`, and `joinphrase`
 * is the literal text between this credit and the next (" feat. ", " & ").
 */
export interface MusicBrainzArtistCredit {
    name?: string;
    joinphrase?: string;
    artist?: MusicBrainzArtistRef;
}

/** One label's involvement in a release, and the catalogue number it issued it under. */
export interface MusicBrainzLabelInfo {
    'catalog-number'?: string;
    label?: {
        id?: string;
        name?: string;
    };
}

export interface MusicBrainzRelease {
    id?: string;
    title?: string;
    /** This release's own date, not the recording's first. `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. */
    date?: string;
    status?: string;
    country?: string;
    'artist-credit'?: MusicBrainzArtistCredit[];
    'release-group'?: {
        id?: string;
        'primary-type'?: string;
        'first-release-date'?: string;
    };
    /** Present only under `inc=labels`. Several entries when a release was a joint issue. */
    'label-info'?: MusicBrainzLabelInfo[];
    /**
     * What the Cover Art Archive holds for this release. Returned on any
     * release lookup, which is why artwork costs no request of its own:
     * `front` is the answer to "is there a cover", and the URL is derivable.
     */
    'cover-art-archive'?: {
        artwork?: boolean;
        front?: boolean;
        back?: boolean;
        count?: number;
    };
}

/** A dated span. `ended` is the only reliable way to tell "still going" from "we do not know". */
export interface MusicBrainzLifeSpan {
    begin?: string;
    end?: string;
    ended?: boolean;
}

/**
 * One relationship an entity has. Under `inc=url-rels` these are links out,
 * and `type` is the vocabulary MusicBrainz curates: `official homepage`,
 * `wikidata`, `wikipedia`, `discogs`, `youtube`, and a long tail.
 */
export interface MusicBrainzRelation {
    type?: string;
    url?: { id?: string; resource?: string };
}

/** The artist entity, as returned by `/artist/{mbid}`. */
export interface MusicBrainzArtist extends MusicBrainzArtistRef {
    /** `Person`, `Group`, `Orchestra`, `Choir`, `Character`, `Other`. */
    type?: string;
    country?: string;
    area?: { name?: string };
    /** Where a group formed or a person was born, which is more specific than `area`. */
    'begin-area'?: MusicBrainzArtist['area'];
    'life-span'?: MusicBrainzLifeSpan;
    relations?: MusicBrainzRelation[];
}

export interface MusicBrainzRecording {
    id?: string;
    title?: string;
    /** Duration in milliseconds, or absent when MusicBrainz has no length for it. */
    length?: number;
    disambiguation?: string;
    /** Earliest release date of this recording, in any form from `YYYY` to `YYYY-MM-DD`. */
    'first-release-date'?: string;
    'artist-credit'?: MusicBrainzArtistCredit[];
    releases?: MusicBrainzRelease[];
    isrcs?: string[];
    tags?: MusicBrainzTag[];
    genres?: MusicBrainzTag[];
}

/** A recording as it comes back from `/recording?query=`, carrying the search engine's confidence. */
export interface MusicBrainzSearchRecording extends MusicBrainzRecording {
    /** 0-100. Present on search results only. */
    score?: number;
}

export interface MusicBrainzRecordingSearchResponse {
    count?: number;
    recordings?: MusicBrainzSearchRecording[];
}

/** `/isrc/{isrc}`: the recordings that carry it, with no score, because the code is the match. */
export interface MusicBrainzIsrcResponse {
    isrc?: string;
    recordings?: MusicBrainzRecording[];
}

/** The error document MusicBrainz returns for a non-2xx when asked for JSON. */
export interface MusicBrainzErrorResponse {
    error?: string;
    help?: string;
}
