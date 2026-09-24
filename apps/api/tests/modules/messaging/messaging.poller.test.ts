// The loop that listens on chat platforms. What is pinned here is what a restart or an outage would
// otherwise get wrong: the cursor is resumed rather than reset, saved only after the batch it covers
// was answered, a failing platform is backed off rather than hammered, and stopping never waits out
// a platform's long poll.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Container } from 'injectkit';
import { TemplateRegistry, type Reply } from '@maroonedsoftware/comms';
import type { Logger } from '@maroonedsoftware/logger';
import type { InboundMessage, MessagingReceiveQuery, MessagingReceiveResult, PluginManifest } from '@deadair/plugin-sdk';

import {
    MESSAGING_BACKOFF_FIRST_MS,
    MESSAGING_BACKOFF_MAX_MS,
    MESSAGING_WAIT_MS,
    MessagingPoller,
    messagingBackoff,
} from '../../../src/modules/messaging/messaging.poller.js';
import { MessagingService } from '../../../src/modules/messaging/messaging.service.js';
import type { MessagingCommands } from '../../../src/modules/messaging/messaging.commands.js';
import { MessagingRepository } from '../../../src/modules/messaging/messaging.repository.js';
import { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

const TELEGRAM = 'deadair.telegram';

const stubLogger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

function manifest(id: string): PluginManifest {
    return {
        id,
        name: id,
        version: '1.0.0',
        capabilities: ['messaging'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
    };
}

const message = (id: string, text = '/now'): InboundMessage => ({
    id,
    chatId: 'chat-1',
    chatKind: 'direct',
    sender: { id: 'u-1', displayName: 'Robin' },
    text,
    sentAt: '2026-09-24T12:00:00.000Z',
});

/**
 * A platform whose polls are scripted: each entry answers one `receive`, and once the script runs
 * out every poll hangs the way a quiet long poll does, until the poller lets go of it.
 */
function build(script: Array<MessagingReceiveResult | Error>, options: { savedCursor?: string } = {}) {
    const queries: MessagingReceiveQuery[] = [];
    const receive = vi.fn(async (query: MessagingReceiveQuery) => {
        queries.push(query);
        const next = script.shift();
        if (next === undefined) return new Promise<MessagingReceiveResult>(() => undefined);
        if (next instanceof Error) throw next;
        return next;
    });
    const send = vi.fn(async () => ({ delivered: true }));

    const record: PluginRecord = {
        id: TELEGRAM,
        dir: `/plugins/${TELEGRAM}`,
        origin: 'bundled',
        status: 'active',
        manifest: manifest(TELEGRAM),
        instance: { init: vi.fn(), receive, send } as never,
    };
    const registry = new PluginRegistry();
    registry.setAll([record]);

    const saved: string[] = [];
    const repository = {
        readCursor: vi.fn(async () => options.savedCursor),
        saveCursor: vi.fn(async (_: string, cursor: string) => {
            saved.push(cursor);
        }),
    };
    const container = {
        createScopedContainer: () => ({
            get: (token: unknown) => {
                if (token !== MessagingRepository) throw new Error('unexpected resolve');
                return repository;
            },
            disposeAsync: async () => undefined,
        }),
    } as unknown as Container;

    const answer = vi.fn(async (_: string, inbound: InboundMessage, reply: Reply) => {
        if (inbound.text === '/now') await reply.send({ text: 'Teardrop' });
    });
    const commands = { dispatch: answer, router: { templates: new TemplateRegistry() } } as unknown as MessagingCommands;

    const messaging = new MessagingService(registry, new PluginInvoker(registry, stubPluginLog().log), stubLogger());
    const poller = new MessagingPoller(container, messaging, commands, stubLogger());

    return { poller, receive, send, queries, saved, answer };
}

let running: MessagingPoller | undefined;

afterEach(async () => {
    await running?.stop();
    running = undefined;
    vi.useRealTimers();
});

describe('the backoff', () => {
    it('starts short and doubles', () => {
        expect(messagingBackoff(1)).toBe(MESSAGING_BACKOFF_FIRST_MS);
        expect(messagingBackoff(2)).toBe(MESSAGING_BACKOFF_FIRST_MS * 2);
        expect(messagingBackoff(3)).toBe(MESSAGING_BACKOFF_FIRST_MS * 4);
    });

    it('is capped, so a long outage is still asked about', () => {
        expect(messagingBackoff(50)).toBe(MESSAGING_BACKOFF_MAX_MS);
    });
});

describe('listening', () => {
    it('answers a command in the chat it came from', async () => {
        const { poller, send } = build([{ messages: [message('m-1')], cursor: 'c-1' }]);
        running = poller;
        poller.start();

        await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ chatId: 'chat-1', text: 'Teardrop' }));
    });

    it('sends nothing for a message that wants no answer', async () => {
        const { poller, send, queries } = build([{ messages: [message('m-1', 'just chatting')], cursor: 'c-1' }]);
        running = poller;
        poller.start();

        await vi.waitFor(() => expect(queries).toHaveLength(2));
        expect(send).not.toHaveBeenCalled();
    });

    it('starts from nothing on a platform never polled, and long-polls', async () => {
        const { poller, queries } = build([]);
        running = poller;
        poller.start();

        await vi.waitFor(() => expect(queries).toHaveLength(1));
        expect(queries[0]).toEqual({ waitMs: MESSAGING_WAIT_MS });
    });

    it('resumes from the saved cursor after a restart', async () => {
        const { poller, queries } = build([], { savedCursor: 'c-41' });
        running = poller;
        poller.start();

        await vi.waitFor(() => expect(queries).toHaveLength(1));
        expect(queries[0]?.cursor).toBe('c-41');
    });

    it('hands back the cursor it was given, and saves it after the batch was answered', async () => {
        const { poller, queries, saved, send } = build([{ messages: [message('m-1')], cursor: 'c-2' }]);
        running = poller;
        poller.start();

        await vi.waitFor(() => expect(queries).toHaveLength(2));
        expect(queries[1]?.cursor).toBe('c-2');
        expect(saved).toEqual(['c-2']);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('keeps its cursor when a poll returns none', async () => {
        const { poller, queries, saved } = build([{ messages: [] }], { savedCursor: 'c-7' });
        running = poller;
        poller.start();

        await vi.waitFor(() => expect(queries).toHaveLength(2));
        expect(queries[1]?.cursor).toBe('c-7');
        expect(saved).toEqual([]);
    });

    it('carries on after a message it could not answer', async () => {
        const { poller, send, answer } = build([{ messages: [message('m-1'), message('m-2')], cursor: 'c-3' }]);
        answer.mockRejectedValueOnce(new Error('boom'));
        running = poller;
        poller.start();

        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    });
});

describe('when a platform fails', () => {
    it('waits before asking again, rather than hammering it', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
        const { poller, receive } = build([new Error('down')]);
        running = poller;
        poller.start();

        // Not `vi.waitFor`, which advances fake timers itself and would spend the backoff.
        await vi.advanceTimersByTimeAsync(0);
        expect(receive).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(MESSAGING_BACKOFF_FIRST_MS - 1);
        expect(receive).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1);
        expect(receive).toHaveBeenCalledTimes(2);
    });
});

describe('stopping', () => {
    it('does not wait out a long poll', async () => {
        const { poller, receive } = build([]);
        poller.start();
        await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));

        // The scripted poll never resolves, so this would hang if stop awaited it.
        await poller.stop();
    });

    it('asks nothing more once stopped', async () => {
        const { poller, receive } = build([]);
        poller.start();
        await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
        await poller.stop();

        expect(receive).toHaveBeenCalledTimes(1);
    });
});
