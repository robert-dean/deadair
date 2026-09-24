import { PLUGIN_CAPABILITY_MESSAGING, type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';

export const PLUGIN_ID = 'deadair.slack';
export const PLUGIN_VERSION = '0.0.1';

/** The Web API, at `https://slack.com/api/`. */
export const SLACK_API_HOST = 'slack.com';

/** The Socket Mode hosts (`wss-primary`, `wss-backup`) and `hooks.slack.com`, where a command's `response_url` points. */
export const SLACK_HOSTS = '*.slack.com';

/** Both share one allowance: a published Slack limit covers the app, not a hostname. */
export const SLACK_BUCKET = 'slack';

/**
 * How many requests a second the app makes, all of them.
 *
 * Slack paces `chat.postMessage` at about one a second per channel and most other methods by the
 * minute. A station answering commands and posting one line per record is far inside that; this
 * keeps a burst of button presses from being what finds it.
 */
export const SLACK_RATE_PER_SECOND = 5;

/** How long a Web API call may take. */
export const REQUEST_TIMEOUT_MS = 10_000;

/** The most text one message may carry. Slack truncates past 40,000; a chat line never needs a tenth of it. */
export const MAX_MESSAGE_LENGTH = 3000;

/** Where the app manifest to paste into Slack is published, since a setting's help cannot hold one legibly. */
export const SETUP_GUIDE_URL = 'https://deadair.radio/docs/features/plugins#setting-up-slack';

export const configSchema = z.object({
    botToken: z.string().optional(),
    appToken: z.string().optional(),
    directMessages: z.union([z.boolean(), z.string()]).optional(),
    channels: z.string().optional(),
    announceChannels: z.string().optional(),
});

export type SlackPluginConfig = z.infer<typeof configSchema>;

export const slackManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'Slack',
    version: PLUGIN_VERSION,
    capabilities: [PLUGIN_CAPABILITY_MESSAGING],
    apiVersion: '^1.0.0',
    description: 'Lets people ask the station what is playing, and request records, from Slack, and tells a channel what goes to air.',
    permissions: {
        network: [
            { host: SLACK_API_HOST, ratePerSecond: SLACK_RATE_PER_SECOND, bucket: SLACK_BUCKET },
            { host: SLACK_HOSTS, ratePerSecond: SLACK_RATE_PER_SECOND, bucket: SLACK_BUCKET },
        ],
        // Slack delivers slash commands and button presses over Socket Mode, a socket the app holds
        // open, and nowhere else without a public address for it to call.
        sockets: true,
        // Nothing to keep: a missed message is not worth a table.
        storage: false,
        oauth: false,
    },
    configFields: [
        {
            key: 'setup',
            label: 'Making an app',
            type: 'note',
            help:
                `At api.slack.com/apps, create a new app From a manifest, and paste the one at ${SETUP_GUIDE_URL}: it turns on Socket ` +
                'Mode and lists the station’s slash commands. Install it to your workspace and paste the Bot User OAuth Token below. ' +
                'Then, under Basic Information, generate an App-Level Token with the connections:write scope and paste that too. ' +
                'Invite the app to each channel it should answer or announce in.',
        },
        {
            key: 'botToken',
            label: 'Bot token',
            type: 'secret',
            required: true,
            help: 'The Bot User OAuth Token, starting xoxb-. It is the app’s password, so keep it to yourself.',
        },
        {
            key: 'appToken',
            label: 'App-level token',
            type: 'secret',
            required: true,
            help: 'The App-Level Token with the connections:write scope, starting xapp-. The station opens its Socket Mode connection with it.',
        },
        {
            key: 'directMessages',
            label: 'Answer direct messages',
            type: 'boolean',
            default: true,
            help: 'Whether the station answers anybody in the workspace who writes to the app one to one.',
        },
        {
            key: 'channels',
            label: 'Channels to answer in',
            type: 'text',
            placeholder: 'C0123456789',
            help:
                'Channel ids, one per line. A channel that is not listed is ignored, and its id is written to this plugin’s log the ' +
                'first time somebody there speaks to the app. A channel’s id is at the bottom of its About tab.',
        },
        {
            key: 'announceChannels',
            label: 'Channels to announce in',
            type: 'text',
            placeholder: 'C0123456789',
            help:
                'Where the station says what it is playing as each record goes to air, one channel id per line, with the app invited ' +
                'to each. Leave it empty and the station only speaks when spoken to.',
        },
    ],
    configSchema,
};
