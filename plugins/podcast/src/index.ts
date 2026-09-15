import { definePlugin } from '@deadair/plugin-sdk';
import { PodcastPlugin, podcastManifest } from './podcast.plugin.js';

export { PodcastPlugin, podcastManifest };

export default definePlugin(podcastManifest, () => new PodcastPlugin());
