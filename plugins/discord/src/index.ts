import { definePlugin } from '@deadair/plugin-sdk';
import { DiscordPlugin, discordManifest } from './discord.plugin.js';

export { DiscordPlugin, discordManifest };

export default definePlugin(discordManifest, () => new DiscordPlugin());
