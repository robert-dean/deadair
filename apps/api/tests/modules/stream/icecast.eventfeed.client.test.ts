// Three things about this client are load-bearing and none is visible in the parse:
// it must stay completely asleep on an Icecast that has no feed (which is every
// install until the container moves off 2.4.4), a count it does read has to reach
// the watcher as a whole number rather than a nudge, and a feed nobody is generating
// events on must be allowed to sit silent indefinitely — the platform `fetch` this
// used to be built on killed an idle body at 300s, and each reconnect stranded one of
// Icecast's hundred client slots until it stopped answering anybody.
//
// So the server here is a real one on the loopback rather than a stubbed transport:
// the bug that motivated the rewrite lived entirely in what the HTTP client does to a
// socket, which a stub is by definition unable to reproduce.

import http from 'node:http';
import type { AddressInfo } from 'node:net';
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

/** An Icecast-shaped event feed on the loopback, which the test writes into. */
async function feedServer() {
    const asked: { path?: string; authorization?: string }[] = [];
    const open: http.ServerResponse[] = [];

    const server = http.createServer((request, response) => {
        asked.push({ path: request.url, authorization: request.headers.authorization });
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        response.flushHeaders();
        open.push(response);
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    return {
        asked,
        base: `http://127.0.0.1:${port}`,
        /**
         * How many connections the SERVER has answered, which is what a test must wait
         * on before writing: `attached()` goes true the moment the client picks a
         * connection to own, which is before the request has reached anybody.
         */
        connections: () => open.length,
        send: (text: string) => open.at(-1)?.write(text),
        end: () => open.at(-1)?.end(),
        async close() {
            for (const response of open) response.destroy();
            server.closeAllConnections();
            await new Promise<void>(resolve => server.close(() => resolve()));
        },
    };
}

/** Wait for something the client does on its own clock, rather than guessing at a delay. */
async function until(condition: () => boolean, what: string): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt++) {
        if (condition()) return;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`timed out waiting for ${what}`);
}

/** Let a read that has already arrived finish reaching the watcher. */
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 20));

describe('IcecastEventFeed', () => {
    const running: { close(): Promise<void> }[] = [];
    const clients: IcecastEventFeed[] = [];

    afterEach(async () => {
        for (const client of clients) client.stop();
        clients.length = 0;
        for (const server of running) await server.close();
        running.length = 0;
        vi.clearAllMocks();
    });

    /** Track both so a failing expectation still tears the socket down. */
    function start(server: { close(): Promise<void> }, client: IcecastEventFeed) {
        running.push(server);
        clients.push(client);
        return client;
    }

    it('opens nothing on an Icecast with no admin API', async () => {
        const feed = await feedServer();
        const client = start(feed, new IcecastEventFeed(stats(undefined).client, logger));

        client.watch('/live.mp3', vi.fn());
        await settle();

        expect(feed.asked).toEqual([]);
    });

    it('attaches as soon as the poll resolves a 2.5 server, not on its own retry', async () => {
        // The order at boot: the watcher starts the feed and the poll in the same
        // breath, so the first look finds nothing resolved yet. Waiting for the idle
        // retry after that would leave a freshly booted station on the poll alone for
        // half a minute for no reason.
        const feed = await feedServer();
        const server = stats(undefined);
        const client = start(feed, new IcecastEventFeed(server.client, logger));

        client.watch('/live.mp3', vi.fn());
        await settle();
        expect(feed.asked).toEqual([]);

        server.resolve({ base: feed.base, password: 'pw' });
        await until(() => feed.asked.length > 0, 'the feed to attach');

        expect(feed.asked.map(call => call.path)).toEqual(['/admin/eventfeed']);
    });

    it('follows the feed with the admin credentials and reports whole counts', async () => {
        const feed = await feedServer();
        const counts: number[] = [];
        const client = start(feed, new IcecastEventFeed(stats({ base: feed.base, password: 'hunter2' }).client, logger));

        client.watch('/live.mp3', count => counts.push(count));
        await until(() => feed.connections() > 0, 'the feed to attach');

        feed.send(`id: 1\r\ndata: ${JSON.stringify({ trigger: 'source-listener-attach', uri: '/live.mp3', 'source-listener-count': 1 })}\r\n\r\n`);
        feed.send(`id: 2\r\ndata: ${JSON.stringify({ trigger: 'source-listeners-changed', uri: '/other.mp3', 'source-listener-count': 9 })}\r\n\r\n`);
        feed.send(`id: 3\r\ndata: ${JSON.stringify({ trigger: 'source-listeners-is-zero', uri: '/live.mp3', 'source-listener-count': 0 })}\r\n\r\n`);
        await until(() => counts.length >= 2, 'both counts for our mount');

        // Our mount only, and the count as sent rather than accumulated.
        expect(counts).toEqual([1, 0]);
        expect(feed.asked[0]).toEqual({
            path: '/admin/eventfeed',
            authorization: `Basic ${Buffer.from('admin:hunter2').toString('base64')}`,
        });
    });

    it('holds a silent feed open rather than treating quiet as a drop', async () => {
        // The failure this replaced: an idle body timed out on a fixed clock, the loop
        // reconnected, and Icecast — which only notices a client is gone when it next
        // writes to one — kept the slot. Nobody is listening in this test, which is
        // exactly when it happened on air.
        const feed = await feedServer();
        const client = start(feed, new IcecastEventFeed(stats({ base: feed.base, password: 'pw' }).client, logger));

        client.watch('/live.mp3', vi.fn());
        await until(() => feed.connections() > 0, 'the feed to attach');

        await settle();

        // One connection, still the same one: a reconnect would have asked twice.
        expect(feed.asked).toHaveLength(1);
        expect(client.attached()).toBe(true);
    });

    it('reconnects when the feed itself ends', async () => {
        const feed = await feedServer();
        const client = start(feed, new IcecastEventFeed(stats({ base: feed.base, password: 'pw' }).client, logger));

        client.watch('/live.mp3', vi.fn());
        await until(() => feed.connections() > 0, 'the feed to attach');

        feed.end();
        await until(() => feed.asked.length > 1, 'the feed to be picked back up');

        expect(client.attached()).toBe(true);
    });

    it('stops reading when it is stopped', async () => {
        const feed = await feedServer();
        const counts: number[] = [];
        const client = start(feed, new IcecastEventFeed(stats({ base: feed.base, password: 'pw' }).client, logger));

        client.watch('/live.mp3', count => counts.push(count));
        await until(() => feed.connections() > 0, 'the feed to attach');

        client.stop();
        await settle();

        expect(client.attached()).toBe(false);
    });
});
