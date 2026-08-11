import { definePlugin } from '@deadair/plugin-sdk';
import { AnalyzerPlugin, analyzerManifest } from './analyzer.plugin.js';

export { AnalyzerPlugin, analyzerManifest };

export default definePlugin(analyzerManifest, () => new AnalyzerPlugin());
