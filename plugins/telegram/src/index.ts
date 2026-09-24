import { definePlugin } from '@deadair/plugin-sdk';
import { TelegramPlugin, telegramManifest } from './telegram.plugin.js';

export { TelegramPlugin, telegramManifest };

export default definePlugin(telegramManifest, () => new TelegramPlugin());
