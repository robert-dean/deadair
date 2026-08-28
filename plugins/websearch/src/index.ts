import { definePlugin } from '@deadair/plugin-sdk';
import { WebSearchPlugin, websearchManifest } from './websearch.plugin.js';

export { WebSearchPlugin, websearchManifest };

export default definePlugin(websearchManifest, () => new WebSearchPlugin());
