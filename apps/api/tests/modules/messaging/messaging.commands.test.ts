// What people can say to the station on a chat platform. The rules worth pinning are the quiet ones:
// a group chat where people talk to each other must not hear the station answer every line, and a
// command another bot answers to must not draw an "I don't know that" from this one.

import { describe, expect, it, vi } from 'vitest';
import type { InboundMessage } from '@deadair/plugin-sdk';

import type { OutgoingMessage, Reply } from '@maroonedsoftware/comms';
import { MessagingCommands, describeNowPlaying, parseCommand, toIncomingEvent } from '../../../src/modules/messaging/messaging.commands.js';
import type { NowPlayingService } from '../../../src/modules/nowplaying/nowplaying.service.js';
import type { MessagingOperator } from '../../../src/modules/messaging/messaging.operator.js';
import type { MessagingRequests } from '../../../src/modules/messaging/messaging.requests.js';
import type { NowPlaying } from '../../../src/modules/nowplaying/types/nowplaying.types.js';

const offAir: NowPlaying = { station: 'Dead Air', onAir: false, listeners: 0, mounts: [] };

const onAir = (overrides: Partial<NowPlaying> = {}): NowPlaying => ({
    station: 'Dead Air',
    onAir: true,
    listeners: 3,
    mounts: [],
    track: { kind: 'record', title: 'Teardrop', artist: 'Massive Attack', album: 'Mezzanine', startedAt: 1 },
    ...overrides,
});

const message = (text: string, chatKind: InboundMessage['chatKind'] = 'direct'): InboundMessage => ({
    id: '1',
    chatId: 'c',
    chatKind,
    sender: { id: 'u', displayName: 'Robin' },
    text,
    sentAt: '2026-09-24T12:00:00.000Z',
});

const operator = {
    link: vi.fn(async () => 'Linked.'),
    unlink: vi.fn(async () => 'Unlinked.'),
    operate: vi.fn(async (_p: string, _m: InboundMessage, verb: string) => `did ${verb}`),
};

/** Dispatch one message and answer with the text of the first reply, or nothing when it stayed quiet. */
async function answer(target: MessagingCommands, pluginId: string, inbound: InboundMessage): Promise<string | undefined> {
    const sent: OutgoingMessage[] = [];
    const reply: Reply = {
        channel: pluginId,
        send: async message => {
            sent.push(message);
        },
        sendTemplate: async () => undefined,
        sendNative: async () => undefined,
    };
    await target.dispatch(pluginId, inbound, reply);
    return sent[0]?.text;
}

const requests = {
    request: vi.fn(async (_p: string, _m: InboundMessage, query: string) => ({ text: `asked for ${query}` })),
    pick: vi.fn(async (_p: string, _m: InboundMessage, trackId: string | undefined) => ({ text: `picked ${trackId}` })),
};

const commands = (nowPlaying: NowPlaying = onAir()) =>
    new MessagingCommands(
        { getNowPlaying: vi.fn(() => nowPlaying) } as unknown as NowPlayingService,
        operator as unknown as MessagingOperator,
        requests as unknown as MessagingRequests,
    );

describe('reading a command', () => {
    it('reads the name and what follows it', () => {
        expect(parseCommand('/request  Teardrop ')).toEqual({ name: 'request', args: 'Teardrop' });
    });

    it('drops the @botname a group chat adds', () => {
        expect(parseCommand('/now@deadair_bot')).toEqual({ name: 'now', args: '' });
    });

    it('lower-cases the name', () => {
        expect(parseCommand('/NOW')).toEqual({ name: 'now', args: '' });
    });

    it('keeps the lines after the first', () => {
        expect(parseCommand('/request Teardrop\nfor Sam')?.args).toBe('Teardrop\nfor Sam');
    });

    it('is not fooled by a sentence or a path', () => {
        expect(parseCommand('hello there')).toBeUndefined();
        expect(parseCommand('/ now')).toBeUndefined();
        expect(parseCommand('/usr/bin/env')).toBeUndefined();
    });
});

describe('what is on air', () => {
    it('names the record, the artist and the album', () => {
        expect(describeNowPlaying(onAir())).toBe('Now playing on Dead Air: Teardrop by Massive Attack (Mezzanine)');
    });

    it('names the programme and who presents it', () => {
        expect(describeNowPlaying(onAir({ show: { name: 'Late Lounge', host: 'Marlowe' } }))).toBe(
            'Now playing on Dead Air: Teardrop by Massive Attack (Mezzanine)\nLate Lounge, with Marlowe',
        );
    });

    it('says the station is talking during a break, rather than naming an artist nobody is', () => {
        expect(describeNowPlaying(onAir({ track: { kind: 'break', title: 'The news', artist: '', startedAt: 1 } }))).toBe(
            'Dead Air is talking right now: The news',
        );
    });

    it('says so when the station is off the air', () => {
        expect(describeNowPlaying(offAir)).toBe('Dead Air is off the air right now.');
    });
});

describe('answering', () => {
    it('answers /now', async () => {
        expect(await answer(commands(), 'p', message('/now'))).toBe('Now playing on Dead Air: Teardrop by Massive Attack (Mezzanine)');
    });

    it('answers /now in a group too', async () => {
        expect(await answer(commands(), 'p', message('/now@deadair_bot', 'group'))).toContain('Teardrop');
    });

    it('greets somebody opening a chat with /start by saying what it can do', async () => {
        expect(await answer(commands(), 'p', message('/start'))).toContain('/now');
    });

    it('answers anything that is not a command in a direct chat with the list of what is', async () => {
        expect(await answer(commands(), 'p', message('hi'))).toContain('/now');
    });

    it('stays quiet in a group when people are talking to each other', async () => {
        expect(await answer(commands(), 'p', message('did you hear that last one', 'group'))).toBeUndefined();
    });

    it('stays quiet in a group about a command it does not know, since another bot may', async () => {
        expect(await answer(commands(), 'p', message('/roll 2d6', 'group'))).toBeUndefined();
    });

    it('says it does not know a command in a direct chat', async () => {
        expect(await answer(commands(), 'p', message('/roll'))).toContain("I don't know /roll");
    });

    it('hands /link its code', async () => {
        const inbound = message('/link  abcd-2345 ');
        expect(await answer(commands(), 'deadair.telegram', inbound)).toBe('Linked.');
        expect(operator.link).toHaveBeenCalledWith('deadair.telegram', inbound, 'abcd-2345');
    });

    it('hands the operator verbs to the operator, which decides who may', async () => {
        for (const verb of ['skip', 'onair', 'offair']) {
            expect(await answer(commands(), 'p', message(`/${verb}`))).toBe(`did ${verb}`);
        }
    });

    it('lists the operator commands apart from everybody else’s', async () => {
        const help = (await answer(commands(), 'p', message('/help'))) ?? '';
        expect(help.indexOf('/skip')).toBeGreaterThan(help.indexOf('Station operators'));
        expect(help.indexOf('/now')).toBeLessThan(help.indexOf('Station operators'));
    });
});

describe('as comms events', () => {
    it('makes a /command a command, named without its slash', () => {
        expect(toIncomingEvent('deadair.telegram', message('/now@bot soon'))).toMatchObject({
            channel: 'deadair.telegram',
            kind: 'command',
            command: { name: 'now', args: 'soon' },
            user: { id: 'u', username: 'Robin' },
            conversation: { id: 'c' },
        });
    });

    it('makes a button press an action, carrying its id and value', () => {
        expect(toIncomingEvent('p', { ...message(''), action: { id: 'request.grant', value: 'r-1' } })).toMatchObject({
            kind: 'action',
            action: { id: 'request.grant', value: 'r-1' },
        });
    });

    it('makes anything else a message', () => {
        expect(toIncomingEvent('p', message('hello')).kind).toBe('message');
    });

    it('stays quiet about a button nothing here knows', async () => {
        expect(await answer(commands(), 'p', { ...message(''), action: { id: 'mystery' } })).toBeUndefined();
    });

    it('hands /request its words, and a pick its record', async () => {
        expect(await answer(commands(), 'p', message('/request teardrop'))).toBe('asked for teardrop');
        expect(await answer(commands(), 'p', { ...message(''), action: { id: 'request.pick', value: 't-1' } })).toBe('picked t-1');
    });

    it('lists /request for everybody', async () => {
        const help = (await answer(commands(), 'p', message('/help'))) ?? '';
        expect(help.indexOf('/request')).toBeLessThan(help.indexOf('Station operators'));
    });
});
