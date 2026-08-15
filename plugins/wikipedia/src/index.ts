import { definePlugin } from '@deadair/plugin-sdk';
import { WikipediaPlugin, wikipediaManifest } from './wikipedia.plugin.js';

export { WikipediaPlugin, wikipediaManifest };

export default definePlugin(wikipediaManifest, () => new WikipediaPlugin());
