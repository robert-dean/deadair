/**
 * What one server of the MediaBrowser family does differently from another.
 *
 * Jellyfin forked from Emby, and the two still answer the same API with the same shapes: the same
 * `/Items` and `/Artists` queries, the same `BaseItemDto`, the same `MediaBrowser` authorization
 * header. The two plugins were 93% the same code. What is left over is this: a handful of facts,
 * each measured against a real server, which each plugin states in its own dialect beside the
 * release it was measured on.
 *
 * A fact belongs here only when the two servers disagree about it. Anything both do the same way is
 * written once in the shared code.
 */
export interface MediaBrowserDialect {
    /** What the server is called in a sentence an operator reads: `Jellyfin`. */
    product: string;
    /** What a server that does not name itself in `/System/Info` is called by the connection test. */
    productFallback: string;
    /**
     * The server's short name: where its item ids are filed in enrichment (`jellyfin`), the name its
     * log lines go under, and the prefix of the virtual whole-library playlist's id.
     */
    source: string;
    /** This plugin's version, which every request names in its authorization header. */
    version: string;
    /** The query parameter a URL handed to a fetcher with no headers of ours carries the key in. */
    keyParam: string;
    /** What one of this server's item ids looks like. An id that does not is never sent. */
    itemId: RegExp;
    /** The route a link into the server's web app names an item by: `details` for `#/details?id=…`. */
    webItemRoute: string;
    /** The fields every track query has to name for the server to send them, when it leaves some out unasked. */
    trackFields?: string;
    /** Whether the playlist listing can be narrowed to audio playlists with `MediaTypes=Audio`. */
    filtersAudioPlaylists: boolean;
    /**
     * Whether a playlist that is gone answers 500 rather than 404. When it does, a 500 is checked
     * against the item itself before it is called a missing playlist rather than a failing server.
     */
    missingPlaylistIs500: boolean;
}

/** The id of the virtual playlist that is the whole library, prefixed so it cannot collide with a real one. */
export const everythingPlaylistId = (dialect: Pick<MediaBrowserDialect, 'source'>): string => `${dialect.source}:all`;
