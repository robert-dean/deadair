import { definePlugin } from '@deadair/plugin-sdk';
import { ytmusicManifest } from './ytmusic.manifest.js';
import { YtMusicPlugin } from './ytmusic.plugin.js';

export { ytmusicManifest } from './ytmusic.manifest.js';
export { YtMusicPlugin } from './ytmusic.plugin.js';

export default definePlugin(ytmusicManifest, () => new YtMusicPlugin());
