import { definePlugin } from '@deadair/plugin-sdk';
import { DeezerPlugin, deezerManifest } from './deezer.plugin.js';

export { DeezerPlugin, deezerManifest };

export default definePlugin(deezerManifest, () => new DeezerPlugin());
