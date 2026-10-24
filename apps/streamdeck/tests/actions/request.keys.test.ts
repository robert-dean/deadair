import { SdkError, type ListenerRequestCreate } from '@deadair/sdk';
import { describe, expect, it, vi } from 'vitest';

import { RequestKeys, type RequestAnswer, type Requests } from '../../src/actions/request.keys.js';
import { requestSvg, svgDataUri } from '../../src/display/key.image.js';
import { fakeKey } from '../fixtures/fake.key.js';

const ORIGIN = 'https://radio.example.com';
const record = { trackId: 'b2c4d6e8-0000-4000-8000-000000000001', title: 'Pale Blue Eyes', artist: 'The Velvet Underground' };

function answer(overrides: Partial<RequestAnswer> = {}): RequestAnswer {
    return { status: 'pending', title: record.title, ...overrides };
}

function deck(requests: Requests | undefined = { createRequest: vi.fn(async () => answer()) }) {
    const log = vi.fn();
    let origin: string | undefined = ORIGIN;
    const keys = new RequestKeys({ requests: () => requests, origin: () => origin, log });
    const key = fakeKey('request');
    return {
        keys,
        key,
        log,
        requests,
        moveTo(next: string | undefined) {
            origin = next;
            keys.refresh();
        },
    };
}

const last = (calls: string[], what: string): string | undefined => calls.filter(call => call.startsWith(what)).at(-1);
const face = (dim: boolean): string => `image ${svgDataUri(requestSvg({ dim }))}`;

describe('RequestKeys', () => {
    it('draws its record and asks for it on a press, with a tick for a request the station took', async () => {
        const { keys, key, requests } = deck();
        keys.show(key, { record, station: ORIGIN });

        expect(last(key.calls, 'title')).toBe('title Pale Blue…\nThe Velvet…');
        expect(last(key.calls, 'image')).toBe(face(false));

        await keys.press('request');
        expect(requests!.createRequest).toHaveBeenCalledWith({ trackId: record.trackId } satisfies ListenerRequestCreate);
        expect(key.calls.at(-1)).toBe('ok');
    });

    it('ticks a request that waits for an operator, because the press did all a press can', async () => {
        const { keys, key } = deck({ createRequest: vi.fn(async () => answer({ status: 'waiting' })) });
        keys.show(key, { record, station: ORIGIN });
        await keys.press('request');
        expect(key.calls.at(-1)).toBe('ok');
    });

    it('shows a refusal as the warning triangle and logs the station’s own words', async () => {
        const reason = 'You already have a request waiting.';
        const { keys, key, log } = deck({ createRequest: vi.fn(async () => answer({ status: 'declined', reason })) });
        keys.show(key, { record, station: ORIGIN });

        await keys.press('request');
        expect(key.calls.at(-1)).toBe('alert');
        expect(log).toHaveBeenCalledWith(`The station turned down the request for “Pale Blue Eyes”: ${reason}`);
    });

    it('asks nothing for a key with no record, and draws it faint', async () => {
        const { keys, key, requests } = deck();
        keys.show(key, {});

        expect(last(key.calls, 'title')).toBe('title Pick a\nrecord');
        expect(last(key.calls, 'image')).toBe(face(true));
        await keys.press('request');
        expect(requests!.createRequest).not.toHaveBeenCalled();
        expect(key.calls.at(-1)).toBe('alert');
    });

    it('stops asking for a record once the deck is pointed at another station', async () => {
        const { keys, key, requests, moveTo } = deck();
        keys.show(key, { record, station: ORIGIN });

        moveTo('https://elsewhere.example.com');
        expect(last(key.calls, 'title')).toBe('title Pick again');
        await keys.press('request');
        expect(requests!.createRequest).not.toHaveBeenCalled();
    });

    it('redraws the one key whose settings changed', () => {
        const { keys, key } = deck();
        keys.show(key, {});
        keys.configure('request', { record, station: ORIGIN });
        expect(last(key.calls, 'title')).toBe('title Pale Blue…\nThe Velvet…');
    });

    it('says in the log why a key may not ask, in words of its own', async () => {
        const { keys, key, log } = deck({ createRequest: vi.fn(async () => Promise.reject(new SdkError(403, 'Forbidden', {}, new Headers()))) });
        keys.show(key, { record, station: ORIGIN });

        await keys.press('request');
        expect(key.calls.at(-1)).toBe('alert');
        expect(log.mock.calls[0]?.[0]).toMatch(/would not let this key ask for a record/);
    });

    it('asks once for a double press', async () => {
        let finish: (value: RequestAnswer) => void = () => undefined;
        const createRequest = vi.fn(() => new Promise<RequestAnswer>(resolve => (finish = resolve)));
        const { keys, key } = deck({ createRequest });
        keys.show(key, { record, station: ORIGIN });

        const first = keys.press('request');
        await keys.press('request');
        finish(answer());
        await first;
        expect(createRequest).toHaveBeenCalledTimes(1);
    });
});
