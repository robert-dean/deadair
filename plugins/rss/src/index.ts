import { definePlugin } from '@deadair/plugin-sdk';
import { RssPlugin, rssManifest } from './rss.plugin.js';

export { RssPlugin, rssManifest };

export default definePlugin(rssManifest, () => new RssPlugin());
