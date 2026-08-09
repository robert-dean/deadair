import { definePlugin } from '@deadair/plugin-sdk';
import { LlmPlugin, llmManifest } from './llm.plugin.js';

export { LlmPlugin, llmManifest };

export default definePlugin(llmManifest, () => new LlmPlugin());
