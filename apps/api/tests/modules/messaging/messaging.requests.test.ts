// `/request` from a chat. What matters: a clear match is asked for at once, several (or several exact
// titles) are offered as buttons, a pressed button's value is looked up rather than trusted, and a
// linked chat account asks as its station account so the rules are one person's wherever they ask from.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import type { Container } from 'injectkit';
import type { InboundMessage } from '@deadair/plugin-sdk';

import {
    MessagingRequests,
    REQUEST_PICK_ACTION,
    describeRequest,
    labelsOf,
    parseRequestArgs,
} from '../../../src/modules/messaging/messaging.requests.js';
import { MessagingRepository } from '../../../src/modules/messaging/messaging.repository.js';
import { RequestDesk } from '../../../src/modules/requests/request.desk.js';
import { RequestsRepository, type RequestRow, type RequestableRow } from '../../../src/modules/requests/requests.repository.js';

const TRACK_ID = '6f1c2c1e-6c55-4e8e-9d51-7a3b0b2c9e11';
const teardrop: RequestableRow = { trackId: TRACK_ID, title: 'Teardrop', artist: 'Massive Attack' };
const tearDown: RequestableRow = { trackId: '7f1c2c1e-6c55-4e8e-9d51-7a3b0b2c9e11', title: 'Tear Down', artist: 'Massive Attack' };

const message: InboundMessage = {
    id: 'm-1',
    chatId: '42',
    chatKind: 'direct',
    sender: { id: '7', displayName: 'Sam' },
    text: '',
    sentAt: '2026-09-24T12:00:00Z',
};

const row = (overrides: Partial<RequestRow> = {}): RequestRow => ({
    id: 'r-1',
    requesterKey: 'chat:deadair.telegram:7',
    requesterName: 'Sam',
    trackId: TRACK_ID,
    title: 'Teardrop',
    artist: 'Massive Attack',
    status: 'queued',
    createdAt: DateTime.now(),
    ...overrides,
});

function build(options: { matches?: RequestableRow[]; linked?: string } = {}) {
    const submit = vi.fn(async () => row());
    const findRequestable = vi.fn(async (id: string) => (id === TRACK_ID ? teardrop : undefined));
    const search = vi.fn(async () => options.matches ?? [teardrop]);
    const scope = {
        get: (token: unknown) => {
            if (token === RequestsRepository) return { search, findRequestable };
            if (token === RequestDesk) return { submit };
            if (token === MessagingRepository) return { linkedActor: vi.fn(async () => options.linked) };
            throw new Error('unexpected resolve');
        },
        disposeAsync: async () => undefined,
    };
    const container = { createScopedContainer: () => scope } as unknown as Container;
    return { requests: new MessagingRequests(container), submit, findRequestable };
}

describe('/request', () => {
    it('asks for the only match at once, as the chat account, and says what became of it', async () => {
        const { requests, submit } = build();

        expect(await requests.request('deadair.telegram', message, 'teardrop')).toEqual({
            text: 'Your request is in: Teardrop by Massive Attack, a few records from now.',
        });
        expect(submit).toHaveBeenCalledWith(
            {
                key: 'chat:deadair.telegram:7',
                name: 'Sam',
                chat: { pluginId: 'deadair.telegram', chatId: '42', chatKind: 'direct', messageId: 'm-1' },
            },
            teardrop,
            undefined,
        );
    });

    it('tidies the name the platform shows, and holds it to the length an app is held to', async () => {
        const { requests, submit } = build();

        await requests.request('p', { ...message, sender: { id: '7', displayName: 'S​a‮m\n' } }, 'teardrop');
        expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Sam' }), teardrop, undefined);

        await requests.request('p', { ...message, sender: { id: '7', displayName: 'x'.repeat(500) } }, 'teardrop');
        expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'x'.repeat(60) }), teardrop, undefined);

        await requests.request('p', { ...message, sender: { id: '7', displayName: '​' } }, 'teardrop');
        expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'a listener' }), teardrop, undefined);
    });

    it('asks for an exact title at once even among several matches', async () => {
        const { requests, submit } = build({ matches: [teardrop, tearDown] });

        await requests.request('p', message, 'Teardrop');

        expect(submit).toHaveBeenCalledWith(expect.anything(), teardrop, undefined);
    });

    it('offers two exact titles by different artists as buttons rather than asking for whichever came first', async () => {
        const cline: RequestableRow = { trackId: '8f1c2c1e-6c55-4e8e-9d51-7a3b0b2c9e11', title: 'Crazy', artist: 'Patsy Cline' };
        const gnarls: RequestableRow = { trackId: '9f1c2c1e-6c55-4e8e-9d51-7a3b0b2c9e11', title: 'Crazy', artist: 'Gnarls Barkley' };
        const train: RequestableRow = { trackId: 'af1c2c1e-6c55-4e8e-9d51-7a3b0b2c9e11', title: 'Crazy Train', artist: 'Ozzy Osbourne' };
        const { requests, submit } = build({ matches: [cline, gnarls, train] });

        expect(await requests.request('p', message, 'crazy')).toEqual({
            text: 'Which one did you mean?',
            buttons: [
                { id: REQUEST_PICK_ACTION, label: 'Crazy, Patsy Cline', value: cline.trackId },
                { id: REQUEST_PICK_ACTION, label: 'Crazy, Gnarls Barkley', value: gnarls.trackId },
            ],
        });
        expect(submit).not.toHaveBeenCalled();
    });

    it('offers several matches as buttons carrying each record’s id', async () => {
        const { requests, submit } = build({ matches: [tearDown, teardrop] });

        expect(await requests.request('p', message, 'tear')).toEqual({
            text: 'Which one did you mean?',
            buttons: [
                { id: REQUEST_PICK_ACTION, label: 'Tear Down, Massive Attack', value: tearDown.trackId },
                { id: REQUEST_PICK_ACTION, label: 'Teardrop, Massive Attack', value: TRACK_ID },
            ],
        });
        expect(submit).not.toHaveBeenCalled();
    });

    it('says so when nothing matches, and asks what to look for when given nothing', async () => {
        expect((await build({ matches: [] }).requests.request('p', message, 'zzz')).text).toContain('does not have anything matching');
        expect((await build().requests.request('p', message, '  ')).text).toContain('/request followed by');
    });

    it('asks as the station account when the chat account is linked, so the rules are one person’s', async () => {
        const { requests, submit } = build({ linked: 'actor-1' });

        await requests.request('p', message, 'teardrop');

        expect(submit).toHaveBeenCalledWith(expect.objectContaining({ key: 'user:actor-1', actorId: 'actor-1' }), teardrop, undefined);
    });
});

describe('a pick', () => {
    it('asks for the record the button named', async () => {
        const { requests, submit } = build();

        await requests.pick('p', message, TRACK_ID);

        expect(submit).toHaveBeenCalledWith(expect.anything(), teardrop, undefined);
    });

    it('treats a value that is not a playable record as no value at all', async () => {
        const { requests, submit, findRequestable } = build();

        expect((await requests.pick('p', message, 'not-a-uuid')).text).toContain('not available');
        expect((await requests.pick('p', message, undefined)).text).toContain('not available');
        expect(findRequestable).not.toHaveBeenCalled();
        expect(submit).not.toHaveBeenCalled();
    });
});

describe('labelsOf', () => {
    it('tells the same title and artist apart by album, then by year', () => {
        const crazy = { title: 'Crazy', artist: 'Patsy Cline' };
        expect(
            labelsOf([
                { trackId: 'a', ...crazy, album: 'Showcase', year: 1961 },
                { trackId: 'b', ...crazy, album: 'Live at the Opry', year: 1988 },
                { trackId: 'c', title: 'Crazy', artist: 'Gnarls Barkley', album: 'St. Elsewhere' },
            ]),
        ).toEqual(['Crazy, Patsy Cline, Showcase', 'Crazy, Patsy Cline, Live at the Opry', 'Crazy, Gnarls Barkley']);
        expect(
            labelsOf([
                { trackId: 'a', ...crazy, album: 'Showcase', year: 1961 },
                { trackId: 'b', ...crazy, album: 'Showcase', year: 1967 },
            ]),
        ).toEqual(['Crazy, Patsy Cline, Showcase, 1961', 'Crazy, Patsy Cline, Showcase, 1967']);
    });
});

describe('describeRequest', () => {
    it('says each outcome in the station’s words, and a refusal’s reason', () => {
        expect(describeRequest(row({ status: 'pending' }))).toBe('Got it: Teardrop by Massive Attack. It will be on in a little while.');
        expect(describeRequest(row({ status: 'waiting' }))).toContain('waiting for the station to say yes');
        expect(describeRequest(row({ status: 'declined', reason: 'The request line is full.' }))).toBe('Sorry: The request line is full.');
    });
});

describe('parseRequestArgs', () => {
    it('is only a search without a colon, however many times it says "for"', () => {
        expect(parseRequestArgs('waiting for tonight')).toEqual({ query: 'waiting for tonight' });
    });

    it('splits the record from who it is for at the last "for" before the colon', () => {
        expect(parseRequestArgs('waiting for tonight for Sam: happy birthday')).toEqual({
            query: 'waiting for tonight',
            dedication: { to: 'Sam', message: 'happy birthday' },
        });
    });

    it('takes a message for nobody in particular', () => {
        expect(parseRequestArgs('teardrop: for everybody working late')).toEqual({
            query: 'teardrop',
            dedication: { message: 'for everybody working late' },
        });
    });

    it('tidies what a listener typed and holds it to a length', () => {
        const parsed = parseRequestArgs(`teardrop for Sam\u0007: ${'x'.repeat(500)}`);
        expect(parsed.dedication?.to).toBe('Sam');
        expect(parsed.dedication?.message).toHaveLength(200);
    });
});

describe('a dedication across a choice', () => {
    it('keeps the dedication for the sender’s pick, and gives it to nobody else’s', async () => {
        const { requests, submit } = build({ matches: [tearDown, teardrop] });
        await requests.request('p', message, 'tear for Danielle: happy birthday');

        await requests.pick('p', { ...message, sender: { id: 'someone-else', displayName: 'Other' } }, TRACK_ID);
        expect(submit).toHaveBeenLastCalledWith(expect.anything(), teardrop, undefined);

        await requests.request('p', message, 'tear for Danielle: happy birthday');
        await requests.pick('p', message, TRACK_ID);
        expect(submit).toHaveBeenLastCalledWith(expect.anything(), teardrop, { to: 'Danielle', message: 'happy birthday' });
    });
});
