import { definePlugin } from '@deadair/plugin-sdk';
import { appleMusicManifest } from './applemusic.manifest.js';
import { AppleMusicPlugin } from './applemusic.plugin.js';

export { appleMusicManifest } from './applemusic.manifest.js';
export { AppleMusicPlugin } from './applemusic.plugin.js';

export default definePlugin(appleMusicManifest, () => new AppleMusicPlugin());
