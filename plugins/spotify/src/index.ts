import { definePlugin } from '@deadair/plugin-sdk';
import { SpotifyPlugin, spotifyManifest } from './spotify.plugin.js';

export { SpotifyPlugin, spotifyManifest };

export default definePlugin(spotifyManifest, () => new SpotifyPlugin());
