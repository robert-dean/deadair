/**
 * The Subsonic response shapes this plugin reads, as Navidrome sends them.
 *
 * Every field is optional. These are an upstream's JSON, not a contract: a
 * server may omit anything, and a field that is present may still be empty.
 * Narrowing happens in the mapping, once, rather than being assumed here.
 *
 * Named for Subsonic because that is the wire format, even though the plugin is
 * named for the one server it is tested against.
 */

/** Every response is wrapped in this, success or failure. */
export interface SubsonicEnvelope<T> {
    'subsonic-response': SubsonicResponseBody & T;
}

export interface SubsonicResponseBody {
    status?: 'ok' | 'failed';
    version?: string;
    /** Present when `status` is `failed`. */
    error?: SubsonicError;
}

/**
 * Subsonic's own error, which arrives inside an HTTP 200. The code is the useful
 * half: the message is a human sentence that varies by server.
 */
export interface SubsonicError {
    /**
     * The protocol's numeric code:
     * 0 generic, 10 missing parameter, 20 client too old, 30 server too old,
     * 40 wrong credentials, 41 token auth not supported, 50 not authorized,
     * 60 trial over, 70 not found.
     */
    code?: number;
    message?: string;
}

/**
 * A song, an album or a folder, depending on where it turned up. Subsonic
 * genuinely uses one shape for all three, which is why the type is named after
 * the protocol's own word for it rather than after a track.
 */
export interface SubsonicChild {
    id?: string;
    parent?: string;
    isDir?: boolean;
    title?: string;
    album?: string;
    artist?: string;
    /** Album id, when this is a song. */
    albumId?: string;
    artistId?: string;
    /** Art id, which is not a URL: it is fed back to `getCoverArt`. */
    coverArt?: string;
    /** Seconds, per the protocol. Everything downstream wants milliseconds. */
    duration?: number;
    track?: number;
    year?: number;
    /** The legacy single-genre field. */
    genre?: string;
    /** OpenSubsonic's replacement for it. Navidrome sends both. */
    genres?: { name?: string }[];
    /** OpenSubsonic, and the reason a local library can hand out an mbid at all. */
    musicBrainzId?: string;
    suffix?: string;
    contentType?: string;
    bitRate?: number;
    size?: number;
    path?: string;
}

export interface SubsonicPlaylist {
    id?: string;
    name?: string;
    comment?: string;
    songCount?: number;
    /** Seconds. */
    duration?: number;
    owner?: string;
    public?: boolean;
    coverArt?: string;
}

export interface SubsonicAlbum {
    id?: string;
    name?: string;
    artist?: string;
    artistId?: string;
    coverArt?: string;
    songCount?: number;
    duration?: number;
    year?: number;
    genre?: string;
    genres?: { name?: string }[];
    musicBrainzId?: string;
    /** OpenSubsonic. An ISO-8601 date, when the server has one. */
    originalReleaseDate?: { year?: number; month?: number; day?: number };
    /** Present on `getAlbum`, absent on a listing. */
    song?: SubsonicChild[];
}

export interface SubsonicArtist {
    id?: string;
    name?: string;
    coverArt?: string;
    albumCount?: number;
    musicBrainzId?: string;
}

/** `getArtistInfo2`, whose contents Navidrome fills from its own metadata agents. */
export interface SubsonicArtistInfo {
    biography?: string;
    musicBrainzId?: string;
    lastFmUrl?: string;
    smallImageUrl?: string;
    mediumImageUrl?: string;
    largeImageUrl?: string;
}

export interface SubsonicSearchResult3 {
    artist?: SubsonicArtist[];
    album?: SubsonicAlbum[];
    song?: SubsonicChild[];
}

export interface PingResponse {
    /** OpenSubsonic servers name themselves here. Navidrome does. */
    type?: string;
    serverVersion?: string;
}

export interface SearchResponse {
    searchResult3?: SubsonicSearchResult3;
}

export interface SongResponse {
    song?: SubsonicChild;
}

export interface PlaylistsResponse {
    playlists?: { playlist?: SubsonicPlaylist[] };
}

export interface PlaylistResponse {
    playlist?: SubsonicPlaylist & { entry?: SubsonicChild[] };
}

export interface AlbumResponse {
    album?: SubsonicAlbum;
}

export interface ArtistInfoResponse {
    artistInfo2?: SubsonicArtistInfo;
}
