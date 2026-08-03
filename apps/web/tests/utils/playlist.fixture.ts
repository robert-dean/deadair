import type { CatalogPlaylist, CatalogPlaylistPage, CatalogSourceError, CatalogTrack } from '@deadair/sdk';

/** A plausible importable playlist. Override only what a case is actually about. */
export function catalogPlaylist(overrides: Partial<CatalogPlaylist> = {}): CatalogPlaylist {
    return {
        pluginId: 'deadair.spotify',
        pluginName: 'Spotify',
        id: 'playlist-1',
        name: 'Friday Night',
        description: 'Upbeat tracks for a Friday night set.',
        trackCount: 24,
        ...overrides,
    };
}

/** A plugin that could not be reached while assembling the catalog page. */
export function catalogSourceError(overrides: Partial<CatalogSourceError> = {}): CatalogSourceError {
    return {
        pluginId: 'deadair.navidrome',
        pluginName: 'Navidrome',
        message: 'Connection timed out',
        ...overrides,
    };
}

/** The full page the list endpoint returns: playlists plus whichever plugins fell over. */
export function catalogPlaylistPage(overrides: Partial<CatalogPlaylistPage> = {}): CatalogPlaylistPage {
    return {
        playlists: [catalogPlaylist()],
        errors: [],
        ...overrides,
    };
}

export function catalogTrack(overrides: Partial<CatalogTrack> = {}): CatalogTrack {
    return {
        id: 'track-1',
        title: 'Good Times',
        artists: ['Chic'],
        album: 'C\'est Chic',
        durationMs: 218000,
        ...overrides,
    };
}
