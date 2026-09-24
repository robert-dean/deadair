// The comms Reply every handler answers through. What it has to get right is where an answer lands
// (the chat it came from, threaded only in a group), that buttons survive the trip, and that a
// template falls back to its portable form because no plugin takes a native payload yet.

import { describe, expect, it, vi } from 'vitest';
import { TemplateRegistry } from '@maroonedsoftware/comms';
import type { Logger } from '@maroonedsoftware/logger';
import type { InboundMessage } from '@deadair/plugin-sdk';

import { replyTo } from '../../../src/modules/messaging/messaging.reply.js';
import type { MessagingService } from '../../../src/modules/messaging/messaging.service.js';

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() } as unknown as Logger;

const inbound = (chatKind: InboundMessage['chatKind']): InboundMessage => ({
    id: 'm-9',
    chatId: 'c-1',
    chatKind,
    sender: { id: 'u', displayName: 'Robin' },
    text: '/now',
    sentAt: '2026-09-24T12:00:00.000Z',
});

const build = (chatKind: InboundMessage['chatKind'] = 'direct', templates = new TemplateRegistry()) => {
    const send = vi.fn(async () => ({ delivered: true }));
    const reply = replyTo({ send } as unknown as MessagingService, templates, logger, 'deadair.telegram', inbound(chatKind));
    return { reply, send };
};

describe('replyTo', () => {
    it('answers in the chat the message came from, unthreaded one to one', async () => {
        const { reply, send } = build('direct');
        await reply.send({ text: 'hi' });

        expect(send).toHaveBeenCalledWith('deadair.telegram', { chatId: 'c-1', text: 'hi' });
    });

    it('threads under the message in a group', async () => {
        const { reply, send } = build('group');
        await reply.send({ text: 'hi' });

        expect(send).toHaveBeenCalledWith('deadair.telegram', { chatId: 'c-1', text: 'hi', replyToId: 'm-9' });
    });

    it('carries buttons, and puts a subject on the first line', async () => {
        const { reply, send } = build();
        await reply.send({ subject: 'A request', text: 'Teardrop', buttons: [{ id: 'request.grant', label: 'Play it', value: 'r-1' }] });

        expect(send).toHaveBeenCalledWith('deadair.telegram', {
            chatId: 'c-1',
            text: 'A request\nTeardrop',
            buttons: [{ id: 'request.grant', label: 'Play it', value: 'r-1' }],
        });
    });

    it('sends a template in its portable form', async () => {
        const templates = new TemplateRegistry().registerDefault('request.card', (data: { title: string }) => ({ text: `Asked for ${data.title}` }));
        const { reply, send } = build('direct', templates);

        await reply.sendTemplate('request.card', { title: 'Teardrop' });

        expect(send).toHaveBeenCalledWith('deadair.telegram', { chatId: 'c-1', text: 'Asked for Teardrop' });
    });

    it('refuses a template nobody registered, and a native payload no plugin can take', async () => {
        const { reply } = build();

        await expect(reply.sendTemplate('nothing', {})).rejects.toThrow('no template called nothing');
        await expect(reply.sendNative({ blocks: [] })).rejects.toThrow('not a native payload');
    });

    it('does not throw when the platform refuses', async () => {
        const send = vi.fn(async () => ({ delivered: false, reason: 'blocked', retryable: false }));
        const reply = replyTo({ send } as unknown as MessagingService, new TemplateRegistry(), logger, 'p', inbound('direct'));

        await expect(reply.send({ text: 'hi' })).resolves.toBeUndefined();
    });
});
