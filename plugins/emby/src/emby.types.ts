/**
 * The parts of Emby's responses this plugin reads.
 *
 * Every field is optional because the server leaves out whatever it has no
 * value for, and some come back `null` rather than absent: the mapping treats
 * both the same. Named as Emby names them, PascalCase included, so a field
 * here can be found in the server's own API documentation by searching for it.
 */

/** `GET /System/Info`. */
export interface EmbySystemInfo {
    ServerName?: string | null;
    Version?: string | null;
    ProductName?: string | null;
}

/** One entry of `GET /Users`. */
export interface EmbyUser {
    Id?: string;
    Name?: string | null;
}

/** A name and the id of the item behind it: an artist credit, a genre. */
export interface EmbyNameId {
    Name?: string | null;
    Id?: string;
}

/** Emby's `BaseItemDto`, as far as a track, an artist or a playlist uses it. */
export interface EmbyItem {
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
    /** Only when `Fields=Overview` asked for it. */
    Overview?: string | null;
}

/** Every list endpoint's envelope. */
export interface EmbyQueryResult {
    Items?: EmbyItem[] | null;
    TotalRecordCount?: number;
}
