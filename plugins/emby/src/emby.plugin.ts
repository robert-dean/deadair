import { MediaBrowserPlugin } from '@deadair/mediabrowser';

import { EMBY } from './emby.dialect.js';

export { embyManifest } from './emby.manifest.js';

/**
 * Emby as a deadair `music-provider`: an operator's own library on their own media server.
 *
 * The shared MediaBrowser plugin speaking Emby's dialect. What that dialect says, and what each fact in
 * it was measured on, is in `emby.dialect.ts`; everything else is `@deadair/mediabrowser`.
 */
export class EmbyPlugin extends MediaBrowserPlugin {
    constructor() {
        super(EMBY);
    }
}
