import { PLUGIN_CAPABILITY_MESSAGING, type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';

export const PLUGIN_ID = 'deadair.discord';
export const PLUGIN_VERSION = '0.0.1';

/** The REST API: the gateway's address, sending, deferring an interaction, registering commands. */
export const DISCORD_API_HOST = 'discord.com';

/** Where `GET /gateway/bot` points (`gateway.discord.gg`), and the regional hosts a session resumes on. */
export const DISCORD_GATEWAY_HOSTS = '*.discord.gg';

/**
 * How many REST requests a second the bot makes, all of them.
 *
 * Discord allows a bot fifty a second overall and paces each route on its own besides. A station
 * answering `/now` and posting one line per record is nowhere near either; this is the host's own
 * ceiling, and it keeps a burst of button presses from being the thing that finds Discord's.
 */
export const DISCORD_RATE_PER_SECOND = 10;

/** How long a REST call may take. */
export const REQUEST_TIMEOUT_MS = 10_000;

/** The most text one message may carry: Discord's own limit. */
export const MAX_MESSAGE_LENGTH = 2000;

export const configSchema = z.object({
    botToken: z.string().optional(),
    directMessages: z.union([z.boolean(), z.string()]).optional(),
    channels: z.string().optional(),
    announceChannels: z.string().optional(),
});

export type DiscordConfig = z.infer<typeof configSchema>;

export const discordManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'Discord',
    version: PLUGIN_VERSION,
    capabilities: [PLUGIN_CAPABILITY_MESSAGING],
    apiVersion: '^1.0.0',
    description: 'Lets people ask the station what is playing, and request records, from Discord, and tells a channel what goes to air.',
    permissions: {
        network: [{ host: DISCORD_API_HOST, ratePerSecond: DISCORD_RATE_PER_SECOND }, DISCORD_GATEWAY_HOSTS],
        // Discord delivers messages, slash commands and button presses over the Gateway, a socket the
        // bot holds open, and nowhere else without a public address for it to call.
        sockets: true,
        // Nothing to keep: a missed message is not worth a table, and the Gateway resumes a session itself.
        storage: false,
        oauth: false,
    },
    configFields: [
        {
            key: 'setup',
            label: 'Making a bot',
            type: 'note',
            help:
                'In the Discord Developer Portal, create an application and open its Bot page. Reset the token and paste it below, and ' +
                'turn on the Message Content Intent on the same page, or the station cannot read a command typed as text. Then, under ' +
                'OAuth2, pick the bot and applications.commands scopes with the Send Messages and Read Message History permissions, and ' +
                'open the link it makes to add the bot to your server. The station registers its slash commands itself.',
        },
        {
            key: 'botToken',
            label: 'Bot token',
            type: 'secret',
            required: true,
            help: 'The token from the Bot page. It is the bot’s password, so keep it to yourself.',
        },
        {
            key: 'directMessages',
            label: 'Answer direct messages',
            type: 'boolean',
            default: true,
            help: 'Whether the station answers anybody who writes to the bot one to one. Anybody who shares a server with it can.',
        },
        {
            key: 'channels',
            label: 'Channels to answer in',
            type: 'text',
            placeholder: '1234567890123456789',
            help:
                'Channel ids, one per line. A channel that is not listed is ignored, and its id is written to this plugin’s log the ' +
                'first time somebody there speaks to the bot. With Developer Mode on, right-click a channel and Copy Channel ID.',
        },
        {
            key: 'announceChannels',
            label: 'Channels to announce in',
            type: 'text',
            placeholder: '1234567890123456789',
            help:
                'Where the station says what it is playing as each record goes to air, one channel id per line. Leave it empty and the ' +
                'station only speaks when spoken to.',
        },
    ],
    configSchema,
};
