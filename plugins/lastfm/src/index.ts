import { definePlugin } from '@deadair/plugin-sdk';
import { LastfmPlugin, lastfmManifest } from './lastfm.plugin.js';

export { LastfmPlugin, lastfmManifest };

export default definePlugin(lastfmManifest, () => new LastfmPlugin());
