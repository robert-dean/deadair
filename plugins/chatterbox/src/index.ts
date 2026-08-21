import { definePlugin } from '@deadair/plugin-sdk';
import { ChatterboxPlugin, chatterboxManifest } from './chatterbox.plugin.js';

export { ChatterboxPlugin, chatterboxManifest };

export default definePlugin(chatterboxManifest, () => new ChatterboxPlugin());
