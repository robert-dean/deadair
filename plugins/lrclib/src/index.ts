import { definePlugin } from '@deadair/plugin-sdk';
import { LrclibPlugin, lrclibManifest } from './lrclib.plugin.js';

export { LrclibPlugin, lrclibManifest };

export default definePlugin(lrclibManifest, () => new LrclibPlugin());
