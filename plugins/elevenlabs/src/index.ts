import { definePlugin } from '@deadair/plugin-sdk';
import { ElevenLabsPlugin, elevenlabsManifest } from './elevenlabs.plugin.js';

export { ElevenLabsPlugin, elevenlabsManifest };

export default definePlugin(elevenlabsManifest, () => new ElevenLabsPlugin());
