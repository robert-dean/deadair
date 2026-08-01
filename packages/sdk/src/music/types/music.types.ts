/**
 * generated from [Artist](file://./../../../../../apps/api/data/contracts/music/music.types.ck#L7)
 */
export interface Artist {
    id: string;
    name: string;
    rating?: number;
}

export interface ArtistInput {
    name: string;
    rating?: number;
}

/**
 * generated from [Album](file://./../../../../../apps/api/data/contracts/music/music.types.ck#L13)
 */
export interface Album {
    id: string;
    name: string;
    artistId: string;
    rating?: number;
}

export interface AlbumInput {
    name: string;
    rating?: number;
}

/**
 * generated from [Track](file://./../../../../../apps/api/data/contracts/music/music.types.ck#L20)
 */
export interface Track {
    id: string;
    title: string;
    artistId: string;
    albumId: string;
    rating?: number;
}

export interface TrackInput {
    title: string;
    rating?: number;
}
