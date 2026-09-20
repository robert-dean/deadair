import { definePlugin } from '@deadair/plugin-sdk';
import { RhapsodePlugin, rhapsodeManifest } from './rhapsode.plugin.js';

export { RhapsodePlugin, rhapsodeManifest };

export default definePlugin(rhapsodeManifest, () => new RhapsodePlugin());
