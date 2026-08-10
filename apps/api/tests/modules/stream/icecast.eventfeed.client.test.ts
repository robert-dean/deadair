// Two things about this client are load-bearing and neither is visible in the parse:
// it must stay completely asleep on an Icecast that has no feed (which is every
// install until the container moves off 2.4.4), and a count it does read has to reach
// the watcher as a whole number rather than a nudge.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { IcecastEventFeed } from '../../../src/modules/stream/icecast.eventfeed.client.js';
import type { IcecastStatsClient } from '../../../src/modules/stream/icecast.stats.client.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

/**
 * A stats client that has, or has not, resolved a 2.5 server — and that can
 * resolve one later, the way the real poll does a moment after boot.
 */
function stats(api?: { base: string; password: string }) {
    let current = api;
    const listeners = new Set<() => void>();

    const client = {
        adminApi: () => current,
        onResolved: (listener: () => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
    return {
        client: client as unknown as IcecastStatsClient,
        /** The poll settling on an endpoint, which is what should wake the feed. */
        resolve(next: { base: string; password: string }) {
            current = next;
            for (const listener of listeners) listener();
        },
    };
}

/** A `fetch` answering with an event stream the test writes into. */
function stubFeed() {
    let push: (text: string) => void = () => {};
    let close: () => void = () => {};
    const asked: { url: string; authorization?: string }[] = [];

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        asked.push({ url: String(url), authorization: headers.authorization });

        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                const encoder = new TextEncoder();
                push = text => controller.enqueue(encoder.encode(text));
                close = () => controller.close();
            },
        });
        return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    return { asked, send: (text: string) => push(text), end: () => close() };
}

/** Let the connection and its reads settle. */
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('IcecastEventFeed', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('opens nothing on an Icecast with no admin API', async () => {
        const feed = stubFeed();
        const client = new IcecastEventFeed(stats(undefined).client, logger);

        client.watch('/live.mp3', vi.fn());
        await settle();
        client.stop();

        expect(feed.asked).toEqual([]);
    });

    it('attaches as soon as the poll resolves a 2.5 server, not on its own retry', async () => {
        // The order at boot: the watcher starts the feed and the poll in the same
        // breath, so the first look finds nothing resolved yet. Waiting for the idle
        // retry after that would leave a freshly booted station on the poll alone for
        // half a minute for no reason.
        const feed = stubFeed();
        const server = stats(undefined);
        const client = new IcecastEventFeed(server.client, logger);

        client.watch('/live.mp3', vi.fn());
        await settle();
        expect(feed.asked).toEqual([]);

        server.resolve({ base: 'http://127.0.0.1:8000', password: 'pw' });
        await settle();
        client.stop();

        expect(feed.asked.map(call => call.url)).toEqual(['http://127.0.0.1:8000/admin/eventfeed']);
    });

    it('follows the feed with the admin credentials and reports whole counts', async () => {
        const feed = stubFeed();
        const counts: number[] = [];
        const client = new IcecastEventFeed(stats({ base: 'http://127.0.0.1:8000', password: 'hunter2' }).client, logger);

        client.watch('/live.mp3', count => counts.push(count));
        await settle();

        feed.send(`id: 1\r\ndata: ${JSON.stringify({ trigger: 'source-listener-attach', uri: '/live.mp3', 'source-listener-count': 1 })}\r\n\r\n`);
        feed.send(`id: 2\r\ndata: ${JSON.stringify({ trigger: 'source-listeners-changed', uri: '/other.mp3', 'source-listener-count': 9 })}\r\n\r\n`);
        feed.send(`id: 3\r\ndata: ${JSON.stringify({ trigger: 'source-listeners-is-zero', uri: '/live.mp3', 'source-listener-count': 0 })}\r\n\r\n`);
        await settle();
        client.stop();

        // Our mount only, and the count as sent rather than accumulated.
        expect(counts).toEqual([1, 0]);
        expect(feed.asked[0]).toEqual({
            url: 'http://127.0.0.1:8000/admin/eventfeed',
            authorization: `Basic ${Buffer.from('admin:hunter2').toString('base64')}`,
        });
    });

    it('stops reading when it is stopped', async () => {
        const feed = stubFeed();
        const counts: number[] = [];
        const client = new IcecastEventFeed(stats({ base: 'http://127.0.0.1:8000', password: 'pw' }).client, logger);

        client.watch('/live.mp3', count => counts.push(count));
        await settle();
        expect(client.attached()).toBe(true);

        client.stop();
        await settle();

        expect(client.attached()).toBe(false);
    });
});
