import { PLUGIN_CAPABILITY_MESSAGING, type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';

export const PLUGIN_ID = 'deadair.telegram';
export const PLUGIN_VERSION = '0.0.1';

export const TELEGRAM_HOST = 'api.telegram.org';

/**
 * How many requests a second the bot makes, all of them.
 *
 * Telegram allows a bot about thirty messages a second overall and one a second into any one chat,
 * and a long poll is one request every twenty-five seconds. Ten is comfortably inside the first
 * and far more than a station answering `/now` will ever reach.
 */
export const TELEGRAM_RATE_PER_SECOND = 10;

/** How long a call that is not a long poll may take. */
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The most text one message may carry. Telegram's own limit is 4096 characters, and a station that
 * ever reaches it has written something nobody wants to read in a chat anyway.
 */
export const MAX_MESSAGE_LENGTH = 4096;

export const configSchema = z.object({
    botToken: z.string().optional(),
    directMessages: z.union([z.boolean(), z.string()]).optional(),
    groupChats: z.string().optional(),
    announceChats: z.string().optional(),
});

export type TelegramConfig = z.infer<typeof configSchema>;

export const telegramManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'Telegram',
    version: PLUGIN_VERSION,
    capabilities: [PLUGIN_CAPABILITY_MESSAGING],
    apiVersion: '^1.0.0',
    description: 'Lets people ask the station what is playing from Telegram, and tells a channel or a group what goes to air.',
    permissions: {
        network: [{ host: TELEGRAM_HOST, ratePerSecond: TELEGRAM_RATE_PER_SECOND }],
        // Nothing to keep: where the station has read up to is the host's, in its own table.
        storage: false,
        oauth: false,
    },
    configFields: [
        {
            key: 'setup',
            label: 'Making a bot',
            type: 'note',
            help:
                'Open a chat with @BotFather in Telegram, send /newbot, and follow the steps. It answers with a token: paste it below. ' +
                'The station then answers anybody who messages the bot. To have it answer in a group as well, add the bot to the group and ' +
                'list the group below; to have it only hear commands there rather than every message, leave BotFather’s privacy mode on.',
        },
        {
            key: 'botToken',
            label: 'Bot token',
            type: 'secret',
            required: true,
            help: 'The token @BotFather gave you. It looks like 123456789:AA… and is the bot’s password, so keep it to yourself.',
        },
        {
            key: 'directMessages',
            label: 'Answer direct messages',
            type: 'boolean',
            default: true,
            help: 'Whether the station answers anybody who writes to the bot one to one. Anyone can find a bot, so turn this off for a private station.',
        },
        {
            key: 'groupChats',
            label: 'Groups to answer in',
            type: 'text',
            placeholder: '-1001234567890',
            help:
                'Group chat ids, one per line. A group that is not listed is ignored, and its id is written to this plugin’s log the ' +
                'first time somebody there speaks to the bot, which is the easiest way to find it.',
        },
        {
            key: 'announceChats',
            label: 'Chats to announce in',
            type: 'text',
            placeholder: '@mystationchannel',
            help:
                'Where the station says what it is playing as each record goes to air: a group id, or a channel’s @name with the bot added ' +
                'as an administrator. One per line. Leave it empty and the station only speaks when spoken to.',
        },
    ],
    configSchema,
};
