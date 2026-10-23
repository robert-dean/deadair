import type { MediaBrowserDialect } from '@deadair/mediabrowser';

export const PLUGIN_VERSION = '0.0.1';

/**
 * What Emby does differently from Jellyfin, each fact measured on Emby 4.10.1.
 *
 * The two servers share an ancestor and still answer the same API, so everything else the plugin does
 * is the shared MediaBrowser code in `@deadair/mediabrowser`.
 */
export const EMBY: MediaBrowserDialect = {
    product: 'Emby',
    productFallback: 'Emby Server',
    source: 'emby',
    version: PLUGIN_VERSION,
    /** `api_key`. Not Jellyfin's `ApiKey`, which Emby does not read: `api_key` answered 200 and `ApiKey` 401. */
    keyParam: 'api_key',
    /** A whole number, written as a string: a track is `"12"` and a playlist `"34"`, not the 32-hex GUID Jellyfin writes. */
    itemId: /^\d+$/,
    /** `<baseUrl>/web/index.html#!/item?id=<id>&serverId=…`, read out of the web app's router. */
    webItemRoute: 'item',
    /** A track's year is left out unless it is named: absent without it, 2005 with it. */
    trackFields: 'ProductionYear',
    /**
     * Every playlist is listed, not only audio ones, because Emby cannot be asked for those: adding
     * `MediaTypes=Audio` made it drop the playlist filter and answer with every item in the library, and
     * a playlist carries no media type to filter by afterwards.
     */
    filtersAudioPlaylists: false,
    /** A playlist that is gone answers 500 rather than 404, as does an album's id handed to the playlist endpoint. */
    missingPlaylistIs500: true,
};
