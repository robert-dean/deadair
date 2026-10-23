import type { MediaBrowserDialect } from '../src/mediabrowser.dialect.js';

/** Jellyfin's dialect as its plugin states it, so the shared code is tested against both servers' facts. */
export const JELLYFIN: MediaBrowserDialect = {
    product: 'Jellyfin',
    productFallback: 'Jellyfin',
    source: 'jellyfin',
    version: '0.0.1',
    keyParam: 'ApiKey',
    itemId: /^[0-9a-f]{32}$/i,
    webItemRoute: 'details',
    filtersAudioPlaylists: true,
    missingPlaylistIs500: false,
};

/** Emby's, likewise. */
export const EMBY: MediaBrowserDialect = {
    product: 'Emby',
    productFallback: 'Emby Server',
    source: 'emby',
    version: '0.0.1',
    keyParam: 'api_key',
    itemId: /^\d+$/,
    webItemRoute: 'item',
    trackFields: 'ProductionYear',
    filtersAudioPlaylists: false,
    missingPlaylistIs500: true,
};
