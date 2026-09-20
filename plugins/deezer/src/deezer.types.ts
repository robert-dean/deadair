/**
 * The parts of the Deezer public API this plugin reads.
 *
 * Field names are Deezer's own, so a response can be compared with the
 * documentation without a translation step. Everything is optional: these
 * describe what an upstream MIGHT send, not what it promises, and the mapping
 * is what decides whether an answer is usable.
 */

/** A list endpoint's envelope. `data` is the only field anything here reads. */
export interface DeezerList<T> {
    data?: T[];
    total?: number;
    next?: string;
}

/** An artist, as `/search/artist` and `/artist/{id}/related` return one. */
export interface DeezerArtist {
    id?: number;
    name?: string;
    /** How many people follow them. Deezer orders `related` itself; this is not read. */
    nb_fan?: number;
}

/**
 * A track, as `/artist/{id}/top` returns one.
 *
 * `artist` is the LEAD and `contributors` is the full credit, which is the
 * distinction the pick path turns on: everything downstream matches a record on
 * its lead artist alone, so a joined credit line is a record named correctly
 * and then dropped as one nothing can find.
 */
export interface DeezerTrack {
    id?: number;
    title?: string;
    artist?: DeezerArtist;
    contributors?: DeezerArtist[];
    album?: { title?: string };
}

/**
 * Deezer's failure shape, which arrives with HTTP 200.
 *
 * `code` 800 is "no data", which is how an id with no neighbours and an id that
 * does not exist both read; the client tells that apart from a real fault so a
 * quiet answer does not become a thrown error.
 */
export interface DeezerErrorResponse {
    error?: {
        type?: string;
        message?: string;
        code?: number;
    };
}

/** "No data": an empty answer wearing an error's clothes. */
export const DEEZER_CODE_NO_DATA = 800;
