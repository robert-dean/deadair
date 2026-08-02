/**
 * generated from [MusicProviderKey](file://./../../../../../apps/api/data/contracts/settings/settings.types.ck#L7)
 */
export type MusicProviderKey = 'spotify' | 'navidrome';

/**
 * generated from [SpotifyMusicProvider](file://./../../../../../apps/api/data/contracts/settings/settings.types.ck#L9)
 */
export interface SpotifyMusicProvider {
    key: 'spotify';
    name: 'Spotify';
    /** The exact OAuth redirect URI that's registered in the Spotify app */
    redirectUri: string;
    /** The client ID of the Spotify app */
    clientId: string;
}

/**
 * generated from [NavidromeMusicProvider](file://./../../../../../apps/api/data/contracts/settings/settings.types.ck#L16)
 */
export interface NavidromeMusicProvider {
    key: 'navidrome';
    name: 'Navidrome';
    /** The URL of the Navidrome instance */
    url: string;
    /** The username of the Navidrome instance */
    username: string;
}

export interface NavidromeMusicProviderInput {
    key: 'navidrome';
    name: 'Navidrome';
    /** The URL of the Navidrome instance */
    url: string;
    /** The username of the Navidrome instance */
    username: string;
    /** The password of the Navidrome instance */
    password: string;
}

/**
 * generated from [MusicProvider](file://./../../../../../apps/api/data/contracts/settings/settings.types.ck#L24)
 */
export type MusicProvider = SpotifyMusicProvider | NavidromeMusicProvider;
export type MusicProviderInput = SpotifyMusicProvider | NavidromeMusicProviderInput;
