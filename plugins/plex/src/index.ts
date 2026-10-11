import { definePlugin } from '@deadair/plugin-sdk';

import { plexManifest } from './plex.manifest.js';
import { PlexPlugin } from './plex.plugin.js';

export { plexManifest } from './plex.manifest.js';
export { PlexPlugin } from './plex.plugin.js';

export default definePlugin(plexManifest, () => new PlexPlugin());
