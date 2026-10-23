/**
 * The parts of a MediaBrowser server's responses the plugins read.
 *
 * Every field is optional because the server leaves out whatever it has no
 * value for, and some come back `null` rather than absent: the mapping treats
 * both the same. Named as the server names them, PascalCase included, so a field
 * here can be found in the server's own API documentation by searching for it.
 */

/** `GET /System/Info`. */
export interface MediaBrowserSystemInfo {
    ServerName?: string | null;
    Version?: string | null;
    ProductName?: string | null;
}

/** One entry of `GET /Users`. */
export interface MediaBrowserUser {
    Id?: string;
    Name?: string | null;
}

/** A name and the id of the item behind it: an artist credit, a genre. */
export interface MediaBrowserNameId {
    Name?: string | null;
    Id?: string;
}

/** The server's `BaseItemDto`, as far as a track, an artist or a playlist uses it. */
export interface MediaBrowserItem {
    Id?: string;
    Name?: string | null;
    /** `Audio` for a track, `Playlist`, `MusicArtist`, `MusicAlbum`, and folders besides. */
    Type?: string | null;
    MediaType?: string | null;
    Album?: string | null;
    AlbumId?: string | null;
    AlbumPrimaryImageTag?: string | null;
    /** Every credited artist, in tag order. */
    Artists?: string[] | null;
    AlbumArtist?: string | null;
    /** In ticks of 100 nanoseconds. */
    RunTimeTicks?: number | null;
    ProductionYear?: number | null;
    /** The track number. */
    IndexNumber?: number | null;
    /** The disc number. */
    ParentIndexNumber?: number | null;
    ImageTags?: Record<string, string> | null;
    /** Only on a playlist, and only when `Fields=ChildCount` asked for it. */
    ChildCount?: number | null;
    /** Only when `Fields=Overview` asked for it. On an artist, a biography; on an album, a review. */
    Overview?: string | null;
    /** Only when `Fields=Genres` asked for it. */
    Genres?: string[] | null;
    /** On an album: its label, when the server read one. Only when `Fields=Studios` asked for it. */
    Studios?: MediaBrowserNameId[] | null;
    /** A release date as an ISO-8601 instant. Only when `Fields=PremiereDate` asked for it. */
    PremiereDate?: string | null;
    /**
     * Ids elsewhere, keyed by the server's own provider names (`MusicBrainzRecording`,
     * `MusicBrainzReleaseGroup` and so on). Only when `Fields=ProviderIds` asked for it.
     */
    ProviderIds?: Record<string, string | null> | null;
}

/** Every list endpoint's envelope. */
export interface MediaBrowserQueryResult {
    Items?: MediaBrowserItem[] | null;
    TotalRecordCount?: number;
}
