import { definePlugin } from '@deadair/plugin-sdk';
import { MusicBrainzPlugin, musicbrainzManifest } from './musicbrainz.plugin.js';

export { MusicBrainzPlugin, musicbrainzManifest };

export default definePlugin(musicbrainzManifest, () => new MusicBrainzPlugin());
