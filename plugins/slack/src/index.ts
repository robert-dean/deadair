import { definePlugin } from '@deadair/plugin-sdk';
import { SlackPlugin, slackManifest } from './slack.plugin.js';

export { SlackPlugin, slackManifest };

export default definePlugin(slackManifest, () => new SlackPlugin());
