/** What `GET /api/get` answers with. Only the fields this plugin reads; the rest is ignored. */
export interface LrclibRecord {
    id?: number;
    trackName?: string;
    artistName?: string;
    albumName?: string;
    /** Seconds, as a float. */
    duration?: number;
    instrumental?: boolean;
    plainLyrics?: string | null;
    syncedLyrics?: string | null;
}

/** The error body LRCLIB answers a failure with. */
export interface LrclibErrorResponse {
    message?: string;
    name?: string;
    statusCode?: number;
}
