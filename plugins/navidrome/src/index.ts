import { definePlugin } from '@deadair/plugin-sdk';

import { navidromeManifest } from './navidrome.manifest.js';
import { NavidromePlugin } from './navidrome.plugin.js';

export { navidromeManifest } from './navidrome.manifest.js';
export { NavidromePlugin } from './navidrome.plugin.js';

export default definePlugin(navidromeManifest, () => new NavidromePlugin());
