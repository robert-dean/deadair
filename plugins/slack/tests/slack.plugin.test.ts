// The plugin against a scripted Web API and a Socket Mode socket the test plays the far end of. What
// is pinned is what the station would get wrong without it: an envelope left unacknowledged, a reply
// to a command that needs the app invited somewhere it is not, buttons Slack refuses for sharing an
// id, a listener's text pinging a channel, a retry after the host gave up, and a token in an error.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakePluginHost, type FakePluginHost, type FakePluginSocket, type RecordedFetchCall } from '@deadair/plugin-sdk/testing';

import { SlackPlugin } from '../src/slack.plugin.js';
import { SLACK_API_HOST, SLACK_HOSTS, slackManifest } from '../src/slack.manifest.js';

const BOT_TOKEN = 'xoxb-SECRET-bot';
const APP_TOKEN = 'xapp-SECRET-app';
const LISTED = 'C111';
const UNLISTED = 'C999';
const DM = 'D123';
const RESPONSE_URL = 'https://hooks.slack.com/commands/T1/1/secret';

let host: FakePluginHost;
let plugin: SlackPlugin;
/** What each Web API method answers; anything unlisted is `{ ok: true }`. */
let methods: Record<string, { status?: number; body?: unknown }>;

const initialize = async (config: Record<string, unknown> = { channels: LISTED }, tokens = { botToken: BOT_TOKEN, appToken: APP_TOKEN }) => {
    host.seedConfig(config);
    for (const [key, value] of Object.entries(tokens)) if (value !== '') host.seedSecret(key, value);
    await plugin.init(host);
};

const methodOf = (call: RecordedFetchCall): string => new URL(call.url).pathname.replace('/api/', '');
const callsTo = (method: string): RecordedFetchCall[] => host.calls.filter(call => methodOf(call) === method);
/** A Web API call's form body, with its JSON-encoded fields decoded. */
const formOf = (call: RecordedFetchCall | undefined): Record<string, unknown> =>
    Object.fromEntries(
        [...new URLSearchParams(call?.body ?? '').entries()].map(([key, value]) =>
            // Only what the client JSON-encoded: an object, an array or a boolean. A timestamp stays a string.
            /^[[{]|^(true|false)$/.test(value) ? [key, JSON.parse(value) as unknown] : [key, value],
        ),
    );
const webhooks = (): RecordedFetchCall[] => host.calls.filter(call => call.url.startsWith('https://hooks.slack.com/'));

/** Starts a poll and brings Socket Mode up to `hello`. */
async function listen(waitMs = 5_000): Promise<{ poll: ReturnType<SlackPlugin['receive']>; socket: FakePluginSocket }> {
    const poll = plugin.receive({ waitMs });
    await expect.poll(() => host.sockets.length).toBe(1);
    const socket = host.sockets[0] as FakePluginSocket;
    socket.receiveJson({ type: 'hello', num_connections: 1 });
    return { poll, socket };
}

let envelope = 0;
const envelopeOf = (socket: FakePluginSocket, type: string, payload: unknown): string => {
    const id = `env-${++envelope}`;
    socket.receiveJson({ type, envelope_id: id, payload, accepts_response_payload: false });
    return id;
};

const messageEvent = (channel: string, text: string, extra: Record<string, unknown> = {}) => ({
    type: 'event_callback',
    team_id: 'T1',
    api_app_id: 'A1',
    event_id: 'Ev1',
    event_time: 1_790_000_000,
    event: {
        type: 'message',
        channel,
        channel_type: channel.startsWith('D') ? 'im' : 'channel',
        user: 'U7',
        text,
        ts: '1790000000.000100',
        ...extra,
    },
});

const slashCommand = (channel: string, command: string, text = '') => ({
    token: 'legacy',
    team_id: 'T1',
    team_domain: 'station',
    channel_id: channel,
    channel_name: 'radio',
    user_id: 'U7',
    user_name: 'robin',
    command,
    text,
    response_url: RESPONSE_URL,
    trigger_id: 'trig-1',
});

beforeEach(() => {
    host = createFakePluginHost();
    plugin = new SlackPlugin();
    envelope = 0;
    methods = {
        'apps.connections.open': { body: { ok: true, url: 'wss://wss-primary.slack.com/link/?ticket=t-1' } },
        'users.info': { body: { ok: true, user: { id: 'U7', name: 'robin', profile: { display_name: 'Robin Hart' } } } },
        'auth.test': { body: { ok: true, user: 'deadair', team: 'The Station' } },
    };
    host.setFetchImpl(async url => {
        if (url.startsWith('https://hooks.slack.com/')) return new Response('ok', { status: 200 });
        const answer = methods[new URL(url).pathname.replace('/api/', '')] ?? { body: { ok: true } };
        return new Response(JSON.stringify(answer.body ?? { ok: true }), {
            status: answer.status ?? 200,
            headers: { 'content-type': 'application/json' },
        });
    });
});

afterEach(async () => {
    await plugin.dispose();
});

describe('manifest', () => {
    it('declares the messaging capability and a socket', () => {
        expect(slackManifest.capabilities).toEqual(['messaging']);
        expect(slackManifest.permissions.sockets).toBe(true);
    });

    it('reaches only Slack, on one allowance', () => {
        expect(slackManifest.permissions.network).toEqual([
            expect.objectContaining({ host: SLACK_API_HOST, bucket: 'slack' }),
            expect.objectContaining({ host: SLACK_HOSTS, bucket: 'slack' }),
        ]);
    });
});

describe('Socket Mode', () => {
    it('opens on the first poll, with the app token, on the URL Slack hands back', async () => {
        await initialize();
        const { socket } = await listen();

        expect(socket.url).toBe('wss://wss-primary.slack.com/link/?ticket=t-1');
        expect(callsTo('apps.connections.open')[0]?.headers?.Authorization).toBe(`Bearer ${APP_TOKEN}`);
    });

    it('acknowledges every envelope', async () => {
        await initialize();
        const { socket } = await listen(200);

        const id = envelopeOf(socket, 'events_api', messageEvent(UNLISTED, 'hello'));

        expect(socket.sentJson()).toContainEqual({ envelope_id: id });
    });

    it('is closed when the plugin is disposed', async () => {
        await initialize();
        const { socket } = await listen();

        await plugin.dispose();

        expect(socket.closed).toBe(true);
    });

    it('fails the poll as the token when Slack refuses the app token', async () => {
        await initialize();
        methods['apps.connections.open'] = { body: { ok: false, error: 'invalid_auth' } };

        await expect(plugin.receive({ waitMs: 0 })).rejects.toMatchObject({ code: 'auth' });
    });

    it('reports a disabled link on the next poll, as something the operator fixes', async () => {
        await initialize();
        const { poll, socket } = await listen();
        socket.receiveJson({ type: 'disconnect', reason: 'link_disabled' });
        await poll;

        await expect(plugin.receive({ waitMs: 0 })).rejects.toMatchObject({ code: 'config', message: expect.stringContaining('Socket Mode') });
    });

    it('asks Slack only once per call, never retrying behind the host', async () => {
        await initialize();
        methods['chat.postMessage'] = { status: 503, body: { ok: false } };

        const result = await plugin.send({ chatId: LISTED, text: 'hello' });

        expect(result).toMatchObject({ delivered: false, retryable: true });
        expect(callsTo('chat.postMessage')).toHaveLength(1);
    });
});

describe('receiving', () => {
    it('hands over a message in a listed channel, by the name the workspace shows, with Slack’s escaping undone', async () => {
        await initialize();
        const { poll, socket } = await listen();

        envelopeOf(socket, 'events_api', messageEvent(LISTED, 'Simon &amp; Garfunkel &lt;3'));

        expect(await poll).toEqual({
            messages: [
                {
                    id: '1790000000.000100',
                    chatId: LISTED,
                    chatKind: 'group',
                    sender: { id: 'U7', displayName: 'Robin Hart' },
                    text: 'Simon & Garfunkel <3',
                    sentAt: new Date(1_790_000_000_000).toISOString(),
                },
            ],
        });
    });

    it('ignores a bot, an edit and a channel nobody listed, logging that channel once', async () => {
        await initialize();
        const { poll, socket } = await listen(200);

        envelopeOf(socket, 'events_api', messageEvent(LISTED, 'beep', { bot_id: 'B1' }));
        envelopeOf(socket, 'events_api', messageEvent(LISTED, 'edited', { subtype: 'message_changed' }));
        envelopeOf(socket, 'events_api', messageEvent(UNLISTED, 'hello'));
        envelopeOf(socket, 'events_api', messageEvent(UNLISTED, 'hello again'));

        expect(await poll).toEqual({ messages: [] });
        const unlisted = (host.logger.info as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(([message]) =>
            String(message).includes('not on the list'),
        );
        expect(unlisted).toEqual([[expect.any(String), { channelId: UNLISTED }]]);
    });

    it('answers direct messages unless the operator turned them off', async () => {
        await initialize({ channels: LISTED, directMessages: false });
        const { poll, socket } = await listen(200);

        envelopeOf(socket, 'events_api', messageEvent(DM, 'hello'));

        expect(await poll).toEqual({ messages: [] });
    });

    it('looks a person’s name up once', async () => {
        await initialize();
        const { poll, socket } = await listen(200);

        envelopeOf(socket, 'events_api', messageEvent(LISTED, 'one'));
        envelopeOf(socket, 'events_api', messageEvent(LISTED, 'two'));
        await poll;

        expect(callsTo('users.info')).toHaveLength(1);
    });
});

describe('slash commands and buttons', () => {
    it('hands a slash command over as the text it stands for, and answers it through its response_url', async () => {
        await initialize();
        const { poll, socket } = await listen();
        envelopeOf(socket, 'slash_commands', slashCommand(LISTED, '/request', 'teardrop for Sam: happy birthday'));

        const [message] = (await poll).messages;
        expect(message).toMatchObject({ text: '/request teardrop for Sam: happy birthday', chatId: LISTED, chatKind: 'group' });

        await plugin.send({ chatId: LISTED, text: 'Asked for Teardrop', replyToId: message?.id });

        expect(webhooks()).toHaveLength(1);
        expect(JSON.parse(webhooks()[0]?.body ?? '{}')).toMatchObject({ text: 'Asked for Teardrop', response_type: 'in_channel' });
        expect(callsTo('chat.postMessage')).toHaveLength(0);
    });

    it('turns away a slash command from a channel nobody listed, telling only the person who asked', async () => {
        await initialize();
        const { poll, socket } = await listen(200);

        envelopeOf(socket, 'slash_commands', slashCommand(UNLISTED, '/now'));

        expect(await poll).toEqual({ messages: [] });
        expect(JSON.parse(webhooks()[0]?.body ?? '{}')).toMatchObject({ response_type: 'ephemeral' });
    });

    it('hands a button press back as the id and value it was sent with', async () => {
        await initialize();
        const { poll, socket } = await listen();

        envelopeOf(socket, 'interactive', {
            type: 'block_actions',
            user: { id: 'U8', username: 'sam', name: 'sam' },
            channel: { id: LISTED },
            trigger_id: 'trig-2',
            response_url: RESPONSE_URL,
            actions: [{ action_id: 'request.pick|1', value: 'track-42', type: 'button' }],
        });

        const [message] = (await poll).messages;
        expect(message).toMatchObject({ text: '', action: { id: 'request.pick', value: 'track-42' }, chatId: LISTED });
    });
});

describe('sending', () => {
    it('posts to the channel as plain text, threaded under the message, with nothing in it able to ping', async () => {
        await initialize();

        const result = await plugin.send({ chatId: LISTED, text: '<!channel> Teardrop & more', replyToId: '1790000000.000100' });

        expect(result).toEqual({ delivered: true });
        const call = callsTo('chat.postMessage')[0];
        expect(call?.headers?.Authorization).toBe(`Bearer ${BOT_TOKEN}`);
        expect(formOf(call)).toMatchObject({
            channel: LISTED,
            text: '&lt;!channel&gt; Teardrop &amp; more',
            mrkdwn: false,
            thread_ts: '1790000000.000100',
        });
    });

    it('does not thread in a direct message', async () => {
        await initialize();

        await plugin.send({ chatId: DM, text: 'hello', replyToId: '1790000000.000100' });

        expect(formOf(callsTo('chat.postMessage')[0])).not.toHaveProperty('thread_ts');
    });

    it('gives every button its own action_id, and carries its value in Slack’s own', async () => {
        await initialize();

        await plugin.send({
            chatId: LISTED,
            text: 'Which one?',
            buttons: [
                { id: 'request.pick', label: 'Teardrop', value: 'track-42' },
                { id: 'request.pick', label: 'Angel', value: 'track-43' },
            ],
        });

        const blocks = formOf(callsTo('chat.postMessage')[0]).blocks as Array<{ type: string; elements?: Array<Record<string, unknown>> }>;
        expect(blocks[0]).toEqual({ type: 'section', text: { type: 'plain_text', text: 'Which one?' } });
        expect(blocks[1]?.elements?.map(element => [element.action_id, element.value])).toEqual([
            ['request.pick|0', 'track-42'],
            ['request.pick|1', 'track-43'],
        ]);
    });

    it('calls a channel the app was never invited to final, with the fix in the reason', async () => {
        await initialize();
        methods['chat.postMessage'] = { body: { ok: false, error: 'not_in_channel' } };

        const result = await plugin.send({ chatId: LISTED, text: 'hello' });

        expect(result).toMatchObject({ delivered: false, retryable: false, reason: expect.stringContaining('Invite it') });
    });

    it('calls a rate limit worth retrying', async () => {
        await initialize();
        methods['chat.postMessage'] = { status: 429, body: { ok: false, error: 'ratelimited' } };

        const result = await plugin.send({ chatId: LISTED, text: 'hello' });

        expect(result).toMatchObject({ delivered: false, retryable: true });
    });

    it('announces in the channels listed for it', async () => {
        await initialize({ announceChannels: `${LISTED}\nC222` });

        expect(await plugin.announceTargets()).toEqual([
            { chatId: LISTED, announcements: ['nowPlaying'] },
            { chatId: 'C222', announcements: ['nowPlaying'] },
        ]);
    });
});

describe('connection test and tokens', () => {
    it('names the app and the workspace', async () => {
        await initialize();

        expect(await plugin.testConnection()).toEqual({ ok: true, message: 'Connected as deadair in The Station.' });
    });

    it('keeps both tokens out of a failure', async () => {
        await initialize();
        host.setFetchImpl(async () => {
            throw new Error(`socket hang up while sending ${BOT_TOKEN} and ${APP_TOKEN}`);
        });

        const result = await plugin.testConnection();

        expect(result.ok).toBe(false);
        expect(result.message).not.toContain(BOT_TOKEN);
        expect(result.message).not.toContain(APP_TOKEN);
    });

    it('is not accepting without both tokens, and a poll says why', async () => {
        await initialize({}, { botToken: BOT_TOKEN, appToken: '' });

        expect(await plugin.accepting()).toBe(false);
        await expect(plugin.receive({ waitMs: 0 })).rejects.toMatchObject({ code: 'config' });
    });
});
