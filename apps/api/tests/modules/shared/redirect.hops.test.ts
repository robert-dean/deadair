import { describe, expect, it, vi } from 'vitest';

import { followRedirects, type RedirectHops } from '../../../src/modules/shared/redirect.hops.js';

const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });

/** A fetch that answers each URL from a table, recording what it was asked. */
function scripted(answers: Record<string, () => Response>) {
    return vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
        const answer = answers[String(input)];
        if (answer === undefined) throw new Error(`unscripted ${String(input)}`);
        return answer();
    });
}

function hops(fetch: ReturnType<typeof scripted>, overrides: Partial<RedirectHops> = {}): RedirectHops {
    return {
        fetch: fetch as unknown as typeof globalThis.fetch,
        maxRedirects: 3,
        beforeHop: async () => {},
        next: (location, from) => new URL(location, from),
        tooMany: () => new Error('too many'),
        ...overrides,
    };
}

describe('followRedirects', () => {
    it('follows a chain to the answer, resolving a relative location against the hop that sent it', async () => {
        const fetch = scripted({
            'https://a.test/x': () => redirect('https://b.test/y'),
            'https://b.test/y': () => redirect('/z', 307),
            'https://b.test/z': () => new Response('bytes', { status: 200 }),
        });

        const response = await followRedirects(new URL('https://a.test/x'), hops(fetch));

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('bytes');
        expect(fetch.mock.calls.map(call => String(call[0]))).toEqual(['https://a.test/x', 'https://b.test/y', 'https://b.test/z']);
    });

    it('never lets the fetch follow a redirect itself, and carries the caller init on every hop', async () => {
        const fetch = scripted({ 'https://a.test/': () => redirect('https://b.test/'), 'https://b.test/': () => new Response('ok') });
        const signal = new AbortController().signal;

        await followRedirects(new URL('https://a.test/'), hops(fetch, { init: { signal, headers: { accept: 'audio/*' } } }));

        for (const [, init] of fetch.mock.calls) {
            expect(init?.redirect).toBe('manual');
            expect(init?.signal).toBe(signal);
            expect(init?.headers).toEqual({ accept: 'audio/*' });
        }
    });

    // The reason this exists: the check runs before the connection, not after.
    it('checks every hop before connecting to it, saying which hop sent it there', async () => {
        const fetch = scripted({ 'https://a.test/': () => redirect('http://127.0.0.1/admin') });
        const seen: [string, string | undefined][] = [];
        const beforeHop = async (address: URL, from: URL | undefined) => {
            seen.push([address.href, from?.href]);
            if (address.hostname === '127.0.0.1') throw new Error('private');
        };

        await expect(followRedirects(new URL('https://a.test/'), hops(fetch, { beforeHop }))).rejects.toThrow('private');

        expect(seen).toEqual([
            ['https://a.test/', undefined],
            ['http://127.0.0.1/admin', 'https://a.test/'],
        ]);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('lets the caller refuse a location before it becomes a hop', async () => {
        const fetch = scripted({ 'https://a.test/': () => redirect('file:///etc/passwd') });
        const next = (location: string, from: URL) => {
            const address = new URL(location, from);
            if (address.protocol !== 'https:') throw new Error(`refusing ${address.protocol}`);
            return address;
        };

        await expect(followRedirects(new URL('https://a.test/'), hops(fetch, { next }))).rejects.toThrow('refusing file:');
    });

    it('cancels the body of every hop it leaves behind', async () => {
        const cancel = vi.fn(async () => {});
        const left = redirect('https://b.test/');
        Object.defineProperty(left, 'body', { value: { cancel } });
        const fetch = scripted({ 'https://a.test/': () => left, 'https://b.test/': () => new Response('ok') });

        await followRedirects(new URL('https://a.test/'), hops(fetch));

        expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('hands back a redirect status with no location as an answer rather than a hop', async () => {
        const fetch = scripted({ 'https://a.test/': () => new Response(null, { status: 302 }) });

        expect((await followRedirects(new URL('https://a.test/'), hops(fetch))).status).toBe(302);
    });

    it('follows maxRedirects hops and refuses the one after, with the caller error', async () => {
        let n = 0;
        const fetch = vi.fn(async () => redirect(`https://a.test/${(n += 1)}`));

        await expect(followRedirects(new URL('https://a.test/0'), hops(fetch as never, { maxRedirects: 2 }))).rejects.toThrow('too many');
        expect(fetch).toHaveBeenCalledTimes(3);
    });
});
