import { definePlugin } from '@deadair/plugin-sdk';
import { KokoroPlugin, kokoroManifest } from './kokoro.plugin.js';

export { KokoroPlugin, kokoroManifest };

export default definePlugin(kokoroManifest, () => new KokoroPlugin());
