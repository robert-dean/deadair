import type { MediaBrowserDialect } from '@deadair/mediabrowser';

export const PLUGIN_VERSION = '0.0.1';

/**
 * What Jellyfin does differently from Emby, each fact measured on Jellyfin 10.11.0.
 *
 * Everything else the plugin does is the shared MediaBrowser code in `@deadair/mediabrowser`. No
 * `trackFields`: Jellyfin sends a track's year unasked.
 */
export const JELLYFIN: MediaBrowserDialect = {
    product: 'Jellyfin',
    productFallback: 'Jellyfin',
    source: 'jellyfin',
    version: PLUGIN_VERSION,
    /** `ApiKey`, the parameter name that replaced the legacy `api_key`. */
    keyParam: 'ApiKey',
    /** 32 hex digits, which is how the server writes a GUID in every response. */
    itemId: /^[0-9a-f]{32}$/i,
    /** `<baseUrl>/web/#/details?id=<id>`, which is what the address bar shows on a playlist's page (`#!/details` before 10.9). */
    webItemRoute: 'details',
    /** `MediaTypes=Audio` narrows the playlist listing to audio playlists, as it says. */
    filtersAudioPlaylists: true,
    /** A playlist that is gone answers 404 (or a bare 400 for an id of the wrong kind), never 500. */
    missingPlaylistIs500: false,
};
