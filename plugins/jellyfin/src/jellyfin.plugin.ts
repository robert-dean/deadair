import { MediaBrowserPlugin } from '@deadair/mediabrowser';

import { JELLYFIN } from './jellyfin.dialect.js';

export { jellyfinManifest } from './jellyfin.manifest.js';

/**
 * Jellyfin as a deadair `music-provider`: an operator's own library on their own media server.
 *
 * The shared MediaBrowser plugin speaking Jellyfin's dialect. What that dialect says, and what each
 * fact in it was measured on, is in `jellyfin.dialect.ts`; everything else is `@deadair/mediabrowser`.
 */
export class JellyfinPlugin extends MediaBrowserPlugin {
    constructor() {
        super(JELLYFIN);
    }
}
