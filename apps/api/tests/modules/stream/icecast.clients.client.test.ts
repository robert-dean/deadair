// The list behind the audience count. What a test has to pin is that every way of not
// knowing stays distinct from an empty room, per mount, and that the request goes to
// the server and with the credential the stats poll already settled on.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { IcecastClientsClient } from '../../../src/modules/stream/icecast.clients.client.js';
import type { IcecastStatsClient } from '../../../src/modules/stream/icecast.stats.client.js';

const BASE = 'http://icecast:8000';
const ADMIN = `Basic ${Buffer.from('admin:secret').toString('base64')}`;

/** A stats client that has, or has not, resolved a 2.5 server, serving these mounts. */
function stats(api: { base: string; password: string } | undefined, mounts = ['/live.mp3']) {
    return { adminApi: () => api, mountPaths: () => [...mounts] } as unknown as IcecastStatsClient;
}

const url = (mount: string) => `${BASE}/admin/listclients.json?mount=${encodeURIComponent(mount)}`;

/** A captured 2.5.0 reply, cut to the fields the parser reads. */
const listing = (mount: string, ...rows: { id: string; ip: string; useragent?: string; connected: number }[]) => [
    { name: 'icestats', ns: 'http://icecast.org/specs/legacystats-0.0.1' },
    { modules: {}, source: { [mount]: { listeners: rows.length, ...(rows.length ? { listener: rows } : {}) } } },
];

/**
 * A `fetch` answering from a url→answer table; anything unlisted is a 404. A number is a
 * status, an Error is thrown, and anything else is a JSON body.
 */
function stubFetch(answers: Record<string, unknown>) {
    const calls: { url: string; authorization?: string }[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (asked: string | URL, init?: RequestInit) => {
            calls.push({ url: String(asked), authorization: (init?.headers as Record<string, string> | undefined)?.authorization });

            const answer = answers[String(asked)];
            if (answer === undefined) return new Response('not found', { status: 404 });
            if (answer instanceof Error) throw answer;
            if (typeof answer === 'number') return new Response('no', { status: answer });
            if (typeof answer === 'string') return new Response(answer, { status: 200 });
            return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
        }),
    );
    return calls;
}

describe('IcecastClientsClient', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('lists who is on each mount, asked as admin at the address the poll found', async () => {
        const calls = stubFetch({
            [url('/live.mp3')]: listing('/live.mp3', { id: '4', ip: '203.0.113.7', useragent: 'VLC/3.0.21', connected: 65 }),
            [url('/live.opus')]: listing('/live.opus'),
        });
        const client = new IcecastClientsClient(stats({ base: BASE, password: 'secret' }, ['/live.mp3', '/live.opus']));

        await expect(client.connections()).resolves.toEqual([
            { mount: '/live.mp3', connections: [{ id: '4', address: '203.0.113.7', agent: 'VLC/3.0.21', connectedMs: 65_000 }] },
            { mount: '/live.opus', connections: [] },
        ]);
        expect(calls).toEqual([
            { url: url('/live.mp3'), authorization: ADMIN },
            { url: url('/live.opus'), authorization: ADMIN },
        ]);
    });

    it('asks nothing until the poll has found a server it can ask', async () => {
        // A 2.4, a station with no admin password yet, or the moments before the first poll.
        const calls = stubFetch({});
        const client = new IcecastClientsClient(stats(undefined, ['/live.mp3', '/live.opus']));

        await expect(client.connections()).resolves.toEqual([
            { mount: '/live.mp3', unreadable: 'unresolved' },
            { mount: '/live.opus', unreadable: 'unresolved' },
        ]);
        expect(calls).toEqual([]);
    });

    it('reads a mount with no source as nobody on it', async () => {
        // Measured: 2.5.0 answers 404 for a configured mount nothing is feeding.
        stubFetch({});
        const client = new IcecastClientsClient(stats({ base: BASE, password: 'secret' }));

        await expect(client.connections()).resolves.toEqual([{ mount: '/live.mp3', connections: [] }]);
    });

    it.each([
        ['a 401', 401, 'refused'],
        ['a 403', 403, 'refused'],
        ['a 500', 500, 'unanswered'],
        ['a request that fails', new Error('ECONNREFUSED'), 'unanswered'],
        ['a body that is not JSON', 'not json', 'unanswered'],
        ['JSON that is not a client list', { icestats: {} }, 'unanswered'],
    ])('reports %s as could-not-read, never as an empty room', async (_name, answer, reason) => {
        stubFetch({ [url('/live.mp3')]: answer });
        const client = new IcecastClientsClient(stats({ base: BASE, password: 'secret' }));

        await expect(client.connections()).resolves.toEqual([{ mount: '/live.mp3', unreadable: reason }]);
    });

    it('costs one mount and not the others when one will not answer', async () => {
        stubFetch({
            [url('/live.mp3')]: listing('/live.mp3', { id: '1', ip: '198.51.100.2', connected: 3 }),
            [url('/live.flac')]: new Error('timeout'),
        });
        const client = new IcecastClientsClient(stats({ base: BASE, password: 'secret' }, ['/live.mp3', '/live.flac']));

        await expect(client.connections()).resolves.toEqual([
            { mount: '/live.mp3', connections: [{ id: '1', address: '198.51.100.2', connectedMs: 3000 }] },
            { mount: '/live.flac', unreadable: 'unanswered' },
        ]);
    });
});
