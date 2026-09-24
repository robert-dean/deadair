// The plugin against a scripted REST API and a Gateway socket the test plays the far end of. What is
// pinned is what the station would get wrong without it: an interaction left unacknowledged past
// Discord's three seconds, a reply to one that goes to the channel instead of the person, a channel
// nobody allowed, a listener's text pinging a whole server, and the bot token in an error message.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakePluginHost, type FakePluginHost, type FakePluginSocket, type RecordedFetchCall } from '@deadair/plugin-sdk/testing';

import { DiscordPlugin, GATEWAY_INTENTS } from '../src/discord.plugin.js';
import { DISCORD_API_HOST, DISCORD_GATEWAY_HOSTS, discordManifest } from '../src/discord.manifest.js';

const TOKEN = 'MTIz.SECRET.token';
const LISTED = '111';
const UNLISTED = '999';
const GUILD = '555';

let host: FakePluginHost;
let plugin: DiscordPlugin;
/** What each REST call answers, by method and path; anything unlisted is a 200 with `{}`. */
let routes: Record<string, { status?: number; body?: unknown }>;

const initialize = async (config: Record<string, unknown> = { channels: LISTED }, token = TOKEN): Promise<void> => {
    host.seedConfig(config);
    if (token !== '') host.seedSecret('botToken', token);
    await plugin.init(host);
};

const pathOf = (call: RecordedFetchCall): string => `${call.method ?? 'GET'} ${new URL(call.url).pathname.replace('/api/v10', '')}`;
const callsTo = (route: string): RecordedFetchCall[] => host.calls.filter(call => pathOf(call) === route);
const bodyOf = (call: RecordedFetchCall | undefined): Record<string, unknown> => JSON.parse(call?.body ?? '{}') as Record<string, unknown>;

/** Starts a poll, then brings the Gateway up to READY. Resolves with the poll still waiting and the socket. */
async function listen(waitMs = 5_000): Promise<{ poll: ReturnType<DiscordPlugin['receive']>; socket: FakePluginSocket }> {
    const poll = plugin.receive({ waitMs });
    await expect.poll(() => host.sockets.length).toBe(1);
    const socket = host.sockets[0] as FakePluginSocket;
    socket.receiveJson({ op: 10, d: { heartbeat_interval: 45_000 } });
    socket.receiveJson({
        op: 0,
        s: 1,
        t: 'READY',
        d: {
            session_id: 's-1',
            resume_gateway_url: 'wss://gateway-us-east1-b.discord.gg',
            user: { id: 'bot', username: 'deadair' },
            application: { id: 'app-1' },
        },
    });
    return { poll, socket };
}

let sequence = 2;
const dispatch = (socket: FakePluginSocket, event: string, data: unknown): void => socket.receiveJson({ op: 0, s: sequence++, t: event, d: data });

const guildMessage = (
    channelId: string,
    content: string,
    author: Record<string, unknown> = { id: 'u-7', username: 'robin', global_name: 'Robin Hart' },
) => ({
    id: 'msg-1',
    channel_id: channelId,
    guild_id: GUILD,
    author,
    member: { nick: null },
    content,
    timestamp: '2026-09-24T12:00:00.000Z',
});

const slashCommand = (channelId: string, name: string, text?: string) => ({
    id: 'int-1',
    token: 'interaction-token',
    type: 2,
    channel_id: channelId,
    guild_id: GUILD,
    member: { user: { id: 'u-7', username: 'robin' }, nick: 'Rob' },
    data: { name, ...(text === undefined ? {} : { options: [{ name: 'text', type: 3, value: text }] }) },
});

const buttonPress = (customId: string) => ({
    id: 'int-2',
    token: 'button-token',
    type: 3,
    channel_id: LISTED,
    guild_id: GUILD,
    member: { user: { id: 'u-8', username: 'sam' } },
    data: { custom_id: customId, component_type: 2 },
});

beforeEach(() => {
    host = createFakePluginHost();
    plugin = new DiscordPlugin();
    routes = {
        'GET /gateway/bot': {
            body: {
                url: 'wss://gateway.discord.gg',
                shards: 1,
                session_start_limit: { total: 1000, remaining: 999, reset_after: 0, max_concurrency: 1 },
            },
        },
        'GET /applications/@me': { body: { id: 'app-1' } },
        'GET /users/@me': { body: { id: 'bot', username: 'deadair' } },
    };
    host.setFetchImpl(async (url, init) => {
        const route = `${init?.method ?? 'GET'} ${new URL(url).pathname.replace('/api/v10', '')}`;
        const answer = routes[route] ?? (route.endsWith('/callback') ? { status: 204 } : { body: {} });
        const status = answer.status ?? 200;
        return new Response(status === 204 ? null : JSON.stringify(answer.body ?? {}), { status, headers: { 'content-type': 'application/json' } });
    });
    sequence = 2;
});

afterEach(async () => {
    await plugin.dispose();
});

describe('manifest', () => {
    it('declares the messaging capability and a socket', () => {
        expect(discordManifest.capabilities).toEqual(['messaging']);
        expect(discordManifest.permissions.sockets).toBe(true);
    });

    it('reaches only the REST API and the Gateway', () => {
        expect(discordManifest.permissions.network).toEqual([expect.objectContaining({ host: DISCORD_API_HOST }), DISCORD_GATEWAY_HOSTS]);
    });
});

describe('the Gateway', () => {
    it('connects on the first poll, on the URL Discord names, asking for message content', async () => {
        await initialize();
        const { socket } = await listen();

        expect(socket.url).toBe('wss://gateway.discord.gg/?v=10&encoding=json');
        const identify = socket.sentJson().find(frame => (frame as { op: number }).op === 2) as { d: { token: string; intents: number } };
        expect(identify.d.token).toBe(TOKEN);
        expect(identify.d.intents).toBe(GATEWAY_INTENTS);
    });

    it('is closed when the plugin is disposed', async () => {
        await initialize();
        const { socket } = await listen();

        await plugin.dispose();

        expect(socket.closed).toBe(true);
    });

    it('reports a missing Message Content Intent on the next poll, as something the operator fixes', async () => {
        await initialize();
        const { poll, socket } = await listen();
        socket.closeFromServer(4014, 'Disallowed intent(s).');
        await poll;

        await expect(plugin.receive({ waitMs: 0 })).rejects.toMatchObject({
            code: 'config',
            message: expect.stringContaining('Message Content Intent'),
        });
    });

    it('fails the poll, as the token, when Discord will not say where the Gateway is', async () => {
        await initialize();
        routes['GET /gateway/bot'] = { status: 401, body: { message: '401: Unauthorized', code: 0 } };

        await expect(plugin.receive({ waitMs: 0 })).rejects.toMatchObject({ code: 'auth' });
    });
});

describe('receiving messages', () => {
    it('hands over a message in a listed channel as a group message', async () => {
        await initialize();
        const { poll, socket } = await listen();

        dispatch(socket, 'MESSAGE_CREATE', guildMessage(LISTED, '/now'));

        expect(await poll).toEqual({
            messages: [
                {
                    id: 'msg-1',
                    chatId: LISTED,
                    chatKind: 'group',
                    sender: { id: 'u-7', displayName: 'Robin Hart' },
                    text: '/now',
                    sentAt: '2026-09-24T12:00:00.000Z',
                },
            ],
        });
    });

    it('ignores a bot, an empty message and a channel nobody listed, logging that channel once', async () => {
        await initialize();
        const { poll, socket } = await listen(200);

        dispatch(socket, 'MESSAGE_CREATE', guildMessage(LISTED, '/now', { id: 'b', username: 'another-bot', bot: true }));
        dispatch(socket, 'MESSAGE_CREATE', guildMessage(LISTED, ''));
        dispatch(socket, 'MESSAGE_CREATE', guildMessage(UNLISTED, '/now'));
        dispatch(socket, 'MESSAGE_CREATE', guildMessage(UNLISTED, '/now'));

        expect(await poll).toEqual({ messages: [] });
        const unlisted = (host.logger.info as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(([message]) =>
            String(message).includes('not on the list'),
        );
        expect(unlisted).toEqual([[expect.any(String), { channelId: UNLISTED, guildId: GUILD }]]);
    });

    it('answers direct messages unless the operator turned them off', async () => {
        await initialize({ channels: LISTED, directMessages: false });
        const { poll, socket } = await listen(200);

        dispatch(socket, 'MESSAGE_CREATE', { ...guildMessage('dm-1', '/now'), guild_id: undefined });

        expect(await poll).toEqual({ messages: [] });
    });

    it('holds what arrived between polls for the next one', async () => {
        await initialize();
        const { poll, socket } = await listen(50);
        await poll;

        dispatch(socket, 'MESSAGE_CREATE', guildMessage(LISTED, '/now'));

        expect((await plugin.receive({ waitMs: 0 })).messages).toHaveLength(1);
    });
});

describe('slash commands and buttons', () => {
    it('defers a slash command at once, then hands it over as the text it stands for', async () => {
        await initialize();
        const { poll, socket } = await listen();

        dispatch(socket, 'INTERACTION_CREATE', slashCommand(LISTED, 'request', 'teardrop for Sam: happy birthday'));

        const [message] = (await poll).messages;
        expect(message).toMatchObject({ text: '/request teardrop for Sam: happy birthday', chatId: LISTED, sender: { displayName: 'Rob' } });
        expect(bodyOf(callsTo('POST /interactions/int-1/interaction-token/callback')[0])).toEqual({ type: 5 });
    });

    it('answers a slash command by replacing its placeholder, and then with follow-ups', async () => {
        await initialize();
        const { poll, socket } = await listen();
        dispatch(socket, 'INTERACTION_CREATE', slashCommand(LISTED, 'now'));
        const [message] = (await poll).messages;

        await plugin.send({ chatId: LISTED, text: 'Teardrop', replyToId: message?.id });
        await plugin.send({ chatId: LISTED, text: 'and another thing', replyToId: message?.id });

        expect(callsTo('PATCH /webhooks/app-1/interaction-token/messages/@original')).toHaveLength(1);
        expect(callsTo('POST /webhooks/app-1/interaction-token')).toHaveLength(1);
        expect(callsTo('POST /channels/111/messages')).toHaveLength(0);
    });

    it('defers a button press without a placeholder, and hands its id and value back', async () => {
        await initialize();
        const { poll, socket } = await listen();

        dispatch(socket, 'INTERACTION_CREATE', buttonPress('request.pick|track-42'));

        const [message] = (await poll).messages;
        expect(message).toMatchObject({ text: '', action: { id: 'request.pick', value: 'track-42' } });
        expect(bodyOf(callsTo('POST /interactions/int-2/button-token/callback')[0])).toEqual({ type: 6 });

        await plugin.send({ chatId: LISTED, text: 'Asked for it', replyToId: message?.id });
        expect(callsTo('POST /webhooks/app-1/button-token')).toHaveLength(1);
    });

    it('turns away a slash command from a channel nobody listed, telling only the person who asked', async () => {
        await initialize();
        const { poll, socket } = await listen(200);

        dispatch(socket, 'INTERACTION_CREATE', slashCommand(UNLISTED, 'now'));

        expect(await poll).toEqual({ messages: [] });
        const callback = bodyOf(callsTo('POST /interactions/int-1/interaction-token/callback')[0]);
        expect(callback).toMatchObject({ type: 4, data: { flags: 64 } });
    });

    it('registers the station’s commands as global slash commands, with a text option where one takes it', async () => {
        await initialize();

        await plugin.commands([
            { name: 'now', description: 'what is on air right now', takesArgs: false },
            { name: 'request', description: 'x'.repeat(150), takesArgs: true },
        ]);

        const [put] = callsTo('PUT /applications/app-1/commands');
        const commands = JSON.parse(put?.body ?? '[]') as Array<{ name: string; description: string; options?: unknown[] }>;
        expect(commands.map(command => command.name)).toEqual(['now', 'request']);
        expect(commands[0]?.options).toBeUndefined();
        expect(commands[1]?.options).toEqual([expect.objectContaining({ type: 3, name: 'text', required: false })]);
        expect(commands[1]?.description).toHaveLength(100);
    });
});

describe('sending', () => {
    it('posts to the channel, threaded under the message, pinging nobody', async () => {
        await initialize();

        const result = await plugin.send({ chatId: LISTED, text: '@everyone Teardrop', replyToId: 'msg-1' });

        expect(result).toEqual({ delivered: true });
        expect(bodyOf(callsTo('POST /channels/111/messages')[0])).toEqual({
            content: '@everyone Teardrop',
            allowed_mentions: { parse: [] },
            message_reference: { message_id: 'msg-1', fail_if_not_exists: false },
        });
    });

    it('carries a button’s value in its custom_id, and leaves off one too long to', async () => {
        await initialize();

        await plugin.send({
            chatId: LISTED,
            text: 'Which one?',
            buttons: [
                { id: 'request.pick', label: 'Teardrop', value: 'track-42' },
                { id: 'request.pick', label: 'Too long', value: 'x'.repeat(120) },
            ],
        });

        expect(bodyOf(callsTo('POST /channels/111/messages')[0]).components).toEqual([
            { type: 1, components: [{ type: 2, style: 1, custom_id: 'request.pick|track-42', label: 'Teardrop' }] },
        ]);
    });

    it('calls a refusal final and an outage worth retrying, with the token nowhere in either', async () => {
        await initialize();
        routes[`POST /channels/${LISTED}/messages`] = { status: 403, body: { message: `Missing Access ${TOKEN}`, code: 50001 } };
        const refused = await plugin.send({ chatId: LISTED, text: 'hello' });
        routes[`POST /channels/${LISTED}/messages`] = { status: 503, body: { message: 'upstream' } };
        const outage = await plugin.send({ chatId: LISTED, text: 'hello' });

        expect(refused).toMatchObject({ delivered: false, retryable: false });
        expect(refused.reason).not.toContain(TOKEN);
        expect(outage).toMatchObject({ delivered: false, retryable: true });
    });

    it('announces in the channels listed for it', async () => {
        await initialize({ announceChannels: `${LISTED}\n222` });

        expect(await plugin.announceTargets()).toEqual([
            { chatId: LISTED, announcements: ['nowPlaying'] },
            { chatId: '222', announcements: ['nowPlaying'] },
        ]);
    });
});

describe('without a token', () => {
    it('is not accepting, and a poll says why', async () => {
        await initialize({}, '');

        expect(await plugin.accepting()).toBe(false);
        await expect(plugin.receive({ waitMs: 0 })).rejects.toMatchObject({ code: 'config' });
    });
});
