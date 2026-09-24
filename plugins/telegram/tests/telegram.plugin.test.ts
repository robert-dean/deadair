// The plugin against a scripted Bot API. What is pinned is what the station would get wrong without
// it: a backlog answered on the first poll, a cursor that stops short of what was filtered out, a
// group nobody allowed, and the bot token turning up in an error message.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';

import { TelegramPlugin } from '../src/telegram.plugin.js';
import { TELEGRAM_HOST, telegramManifest } from '../src/telegram.manifest.js';

const TOKEN = '123456:SECRET-token';

let host: FakePluginHost;
let plugin: TelegramPlugin;

/** `''` for a plugin whose token was never set. */
const initialize = async (config: Record<string, unknown> = {}, token = TOKEN): Promise<void> => {
    host.seedConfig(config);
    if (token !== '') host.seedSecret('botToken', token);
    await plugin.init(host);
};

const queue = (body: unknown, status = 200): void => host.queueResponse({ status, body: JSON.stringify(body) });

const textUpdate = (updateId: number, text: string, chat: { id: number; type: string; title?: string } = { id: 42, type: 'private' }) => ({
    update_id: updateId,
    message: { message_id: updateId * 10, from: { id: 7, first_name: 'Robin', last_name: 'Hart' }, chat, date: 1_790_000_000, text },
});

const bodyOf = (index: number): Record<string, unknown> => JSON.parse(host.calls[index]?.body ?? '{}') as Record<string, unknown>;

beforeEach(() => {
    host = createFakePluginHost();
    plugin = new TelegramPlugin();
});

describe('manifest', () => {
    it('declares the messaging capability and nothing else', () => {
        expect(telegramManifest.capabilities).toEqual(['messaging']);
    });

    it('reaches only the Bot API', () => {
        expect(telegramManifest.permissions.network).toEqual([expect.objectContaining({ host: TELEGRAM_HOST })]);
    });
});

describe('receiving', () => {
    it('starts from now on the first poll, confirming past the backlog and answering none of it', async () => {
        await initialize();
        queue({ ok: true, result: [textUpdate(900, '/now')] });

        const result = await plugin.receive({ waitMs: 25_000 });

        expect(result).toEqual({ messages: [], cursor: '901' });
        expect(bodyOf(0)).toMatchObject({ offset: -1, timeout: 0 });
    });

    it('long-polls straight away on the first poll when Telegram holds nothing', async () => {
        await initialize();
        queue({ ok: true, result: [] });
        queue({ ok: true, result: [textUpdate(5, '/now')] });

        const result = await plugin.receive({ waitMs: 25_000 });

        expect(result.messages).toHaveLength(1);
        expect(result.cursor).toBe('6');
        expect(bodyOf(1)).toEqual({ timeout: 25, allowed_updates: ['message', 'callback_query'] });
    });

    it('asks from the cursor it is handed, waiting as long as it is allowed', async () => {
        await initialize();
        queue({ ok: true, result: [] });

        await plugin.receive({ cursor: '77', waitMs: 25_000 });

        expect(bodyOf(0)).toEqual({ offset: 77, timeout: 25, allowed_updates: ['message', 'callback_query'] });
        expect(host.calls[0]?.url).toBe(`https://${TELEGRAM_HOST}/bot${TOKEN}/getUpdates`);
    });

    it('maps a direct message', async () => {
        await initialize();
        queue({ ok: true, result: [textUpdate(3, '/now')] });

        const { messages } = await plugin.receive({ cursor: '3', waitMs: 1_000 });

        expect(messages).toEqual([
            {
                id: '30',
                chatId: '42',
                chatKind: 'direct',
                sender: { id: '7', displayName: 'Robin Hart' },
                text: '/now',
                sentAt: new Date(1_790_000_000 * 1000).toISOString(),
            },
        ]);
    });

    it('moves the cursor past what it filters out, or those updates would come back forever', async () => {
        await initialize();
        const sticker = { update_id: 12, message: { message_id: 1, from: { id: 7 }, chat: { id: 42, type: 'private' }, date: 1 } };
        const fromBot = { update_id: 13, message: { ...textUpdate(13, '/now').message, from: { id: 8, is_bot: true, first_name: 'Other' } } };
        queue({ ok: true, result: [sticker, fromBot] });

        const result = await plugin.receive({ cursor: '12', waitMs: 1_000 });

        expect(result).toEqual({ messages: [], cursor: '14' });
    });

    it('ignores a group that is not listed, and logs its id once so the operator can add it', async () => {
        await initialize();
        const group = { id: -100_555, type: 'supergroup', title: 'Listeners' };
        queue({ ok: true, result: [textUpdate(20, '/now', group), textUpdate(21, '/now', group)] });

        const { messages } = await plugin.receive({ cursor: '20', waitMs: 1_000 });

        expect(messages).toEqual([]);
        const logged = vi.mocked(host.logger.info).mock.calls.filter(call => String(call[0]).includes('not on the list'));
        expect(logged).toEqual([[expect.any(String), { chatId: '-100555', title: 'Listeners' }]]);
    });

    it('answers in a listed group', async () => {
        await initialize({ groupChats: '-100555\n-100666' });
        queue({ ok: true, result: [textUpdate(20, '/now', { id: -100_555, type: 'supergroup' })] });

        const { messages } = await plugin.receive({ cursor: '20', waitMs: 1_000 });

        expect(messages).toEqual([expect.objectContaining({ chatId: '-100555', chatKind: 'group' })]);
    });

    it('ignores direct messages when the operator turned them off, whether stored as a boolean or as text', async () => {
        for (const off of [false, 'false']) {
            host = createFakePluginHost();
            plugin = new TelegramPlugin();
            await initialize({ directMessages: off });
            queue({ ok: true, result: [textUpdate(3, '/now')] });

            expect((await plugin.receive({ cursor: '3', waitMs: 1_000 })).messages).toEqual([]);
        }
    });

    it('throws an auth error for a token Telegram does not accept', async () => {
        await initialize();
        queue({ ok: false, error_code: 401, description: 'Unauthorized' }, 401);

        await expect(plugin.receive({ cursor: '1', waitMs: 1_000 })).rejects.toMatchObject({ code: 'auth' });
    });

    it('refuses to poll with no token, so the host is not polling for nothing', async () => {
        await initialize({}, '');

        expect(await plugin.accepting()).toBe(false);
        await expect(plugin.receive({ waitMs: 1_000 })).rejects.toMatchObject({ code: 'config' });
    });
});

describe('sending', () => {
    it('sends plain text, with no link previews, threaded when asked', async () => {
        await initialize();
        queue({ ok: true, result: { message_id: 1, chat: { id: 42, type: 'private' }, date: 1 } });

        expect(await plugin.send({ chatId: '42', text: 'Now playing: <b>x</b>', replyToId: '30' })).toEqual({ delivered: true });
        expect(bodyOf(0)).toEqual({
            chat_id: '42',
            text: 'Now playing: <b>x</b>',
            link_preview_options: { is_disabled: true },
            reply_parameters: { message_id: 30, allow_sending_without_reply: true },
        });
    });

    it('says a rate limit is worth retrying', async () => {
        await initialize();
        queue({ ok: false, error_code: 429, description: 'Too Many Requests: retry after 3' }, 429);

        expect(await plugin.send({ chatId: '42', text: 'hi' })).toMatchObject({ delivered: false, retryable: true });
    });

    it('says a bot that was blocked is not', async () => {
        await initialize();
        queue({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, 403);

        expect(await plugin.send({ chatId: '42', text: 'hi' })).toEqual({
            delivered: false,
            reason: 'Telegram refused: Forbidden: bot was blocked by the user',
            retryable: false,
        });
    });

    it('cuts a message longer than Telegram takes', async () => {
        await initialize();
        queue({ ok: true, result: {} });

        await plugin.send({ chatId: '42', text: 'x'.repeat(5000) });

        expect(String(bodyOf(0).text)).toHaveLength(4096);
    });
});

describe('announcing', () => {
    it('announces what airs in every listed chat', async () => {
        await initialize({ announceChats: '@mystation\n-100777' });

        expect(await plugin.announceTargets()).toEqual([
            { chatId: '@mystation', announcements: ['nowPlaying'] },
            { chatId: '-100777', announcements: ['nowPlaying'] },
        ]);
    });

    it('announces nowhere by default', async () => {
        await initialize();

        expect(await plugin.announceTargets()).toEqual([]);
    });
});

describe('testing the connection', () => {
    it('names the bot it connected as', async () => {
        await initialize();
        queue({ ok: true, result: { id: 1, is_bot: true, username: 'deadair_bot' } });
        queue({ ok: true, result: { url: '' } });

        expect(await plugin.testConnection()).toEqual({ ok: true, message: 'Connected as @deadair_bot.' });
    });

    it('says so when a webhook would take the updates', async () => {
        await initialize();
        queue({ ok: true, result: { id: 1, is_bot: true, username: 'deadair_bot' } });
        queue({ ok: true, result: { url: 'https://example.test/hook' } });

        expect(await plugin.testConnection()).toMatchObject({ ok: false });
    });
});

describe('keeping the token out of errors', () => {
    it('scrubs what a failed fetch throws', async () => {
        await initialize();
        host.setFetchImpl(async url => {
            throw new Error(`network down reaching ${url}`);
        });

        const failure = await plugin.receive({ cursor: '1', waitMs: 1_000 }).catch((error: unknown) => error as Error);

        expect(failure.message).not.toContain(TOKEN);
    });

    it('says a send that never reached Telegram is worth retrying, without the token', async () => {
        await initialize();
        host.setFetchImpl(async url => {
            throw new Error(`socket hang up at ${url}`);
        });

        const result = await plugin.send({ chatId: '42', text: 'hi' });

        expect(result).toMatchObject({ delivered: false, retryable: true });
        expect(result.reason).not.toContain(TOKEN);
    });

    it('keeps the token out of the connection test too', async () => {
        await initialize();
        host.setFetchImpl(async url => {
            throw new Error(`refused ${url}`);
        });

        const result = await plugin.testConnection();

        expect(result.ok).toBe(false);
        expect(result.message).not.toContain(TOKEN);
    });
});

describe('the transport', () => {
    it('goes through the host, never around it', async () => {
        await initialize();
        queue({ ok: true, result: [] });

        await plugin.receive({ cursor: '1', waitMs: 25_000 });

        expect(host.calls).toHaveLength(1);
        expect(host.calls[0]?.method).toBe('POST');
    });

    it('calls a rate limit a rate limit, so the host backs off rather than blaming the token', async () => {
        await initialize();
        queue({ ok: false, error_code: 429, description: 'Too Many Requests: retry after 3', parameters: { retry_after: 3 } }, 429);

        await expect(plugin.receive({ cursor: '1', waitMs: 1_000 })).rejects.toMatchObject({ code: 'rate_limited' });
    });

    it('calls a webhook in the way a configuration problem', async () => {
        await initialize();
        queue({ ok: false, error_code: 409, description: "Conflict: can't use getUpdates method while webhook is active" }, 409);

        await expect(plugin.receive({ cursor: '1', waitMs: 1_000 })).rejects.toMatchObject({ code: 'config' });
    });
});

describe('buttons', () => {
    it('sends buttons as an inline keyboard, the id and value carried in callback_data', async () => {
        await initialize();
        queue({ ok: true, result: {} });

        await plugin.send({
            chatId: '42',
            text: 'A request',
            buttons: [
                { id: 'request.grant', label: 'Play it', value: '6f1c2c1e-6c55-4e8e-9d51-7a3b0b2c9e11' },
                { id: 'request.decline', label: 'Not now', value: '6f1c2c1e-6c55-4e8e-9d51-7a3b0b2c9e11' },
            ],
        });

        expect(bodyOf(0).reply_markup).toEqual({
            inline_keyboard: [
                [
                    { text: 'Play it', callback_data: 'request.grant|6f1c2c1e-6c55-4e8e-9d51-7a3b0b2c9e11' },
                    { text: 'Not now', callback_data: 'request.decline|6f1c2c1e-6c55-4e8e-9d51-7a3b0b2c9e11' },
                ],
            ],
        });
    });

    it('leaves off a button too long for Telegram rather than cutting its value short', async () => {
        await initialize();
        queue({ ok: true, result: {} });

        await plugin.send({ chatId: '42', text: 'x', buttons: [{ id: 'a', label: 'A', value: 'v'.repeat(80) }] });

        expect(bodyOf(0).reply_markup).toBeUndefined();
    });

    it('hands a press back as an action on the message it was on, and acknowledges it', async () => {
        await initialize();
        queue({
            ok: true,
            result: [
                {
                    update_id: 30,
                    callback_query: {
                        id: 'cb-1',
                        from: { id: 7, first_name: 'Robin' },
                        message: { message_id: 555, chat: { id: 42, type: 'private' }, date: 1 },
                        data: 'request.grant|abc',
                    },
                },
            ],
        });
        queue({ ok: true, result: true });

        const { messages, cursor } = await plugin.receive({ cursor: '30', waitMs: 1_000 });

        expect(messages).toEqual([
            expect.objectContaining({
                id: '555',
                chatId: '42',
                text: '',
                sender: { id: '7', displayName: 'Robin' },
                action: { id: 'request.grant', value: 'abc' },
            }),
        ]);
        expect(cursor).toBe('31');
        expect(host.calls[1]?.url).toContain('/answerCallbackQuery');
        expect(bodyOf(1)).toEqual({ callback_query_id: 'cb-1' });
    });

    it('ignores a press in a group nobody allowed, but still acknowledges it', async () => {
        await initialize();
        queue({
            ok: true,
            result: [
                {
                    update_id: 31,
                    callback_query: { id: 'cb-2', from: { id: 7 }, message: { message_id: 1, chat: { id: -5, type: 'group' }, date: 1 }, data: 'x' },
                },
            ],
        });
        queue({ ok: true, result: true });

        expect((await plugin.receive({ cursor: '31', waitMs: 1_000 })).messages).toEqual([]);
        expect(host.calls).toHaveLength(2);
    });

    it('keeps polling when a press cannot be acknowledged', async () => {
        await initialize();
        queue({
            ok: true,
            result: [
                {
                    update_id: 32,
                    callback_query: {
                        id: 'cb-3',
                        from: { id: 7 },
                        message: { message_id: 1, chat: { id: 42, type: 'private' }, date: 1 },
                        data: 'x',
                    },
                },
            ],
        });
        queue({ ok: false, error_code: 400, description: 'Bad Request: query is too old' }, 400);

        expect((await plugin.receive({ cursor: '32', waitMs: 1_000 })).messages).toHaveLength(1);
    });
});
