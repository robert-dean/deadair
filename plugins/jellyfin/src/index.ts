import { definePlugin } from '@deadair/plugin-sdk';

import { jellyfinManifest } from './jellyfin.manifest.js';
import { JellyfinPlugin } from './jellyfin.plugin.js';

export { jellyfinManifest } from './jellyfin.manifest.js';
export { JellyfinPlugin } from './jellyfin.plugin.js';

export default definePlugin(jellyfinManifest, () => new JellyfinPlugin());
