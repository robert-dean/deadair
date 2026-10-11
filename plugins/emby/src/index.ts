import { definePlugin } from '@deadair/plugin-sdk';

import { embyManifest } from './emby.manifest.js';
import { EmbyPlugin } from './emby.plugin.js';

export { embyManifest } from './emby.manifest.js';
export { EmbyPlugin } from './emby.plugin.js';

export default definePlugin(embyManifest, () => new EmbyPlugin());
