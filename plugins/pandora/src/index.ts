import { definePlugin } from '@deadair/plugin-sdk';

import { pandoraManifest } from './pandora.manifest.js';
import { PandoraPlugin } from './pandora.plugin.js';

export { pandoraManifest } from './pandora.manifest.js';
export { PandoraPlugin } from './pandora.plugin.js';

export default definePlugin(pandoraManifest, () => new PandoraPlugin());
