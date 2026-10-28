// The operator's list of who is listening. The halves are each tested where they live; what this
// pins is the join: Icecast first in mount order, then HLS, each longest-connected first, a mount
// that could not be read listed apart and never as empty, and the station's own count beside the
// list rather than derived from it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HLS_PRESENCE_MS, HlsAudience } from '../../../src/modules/stream/hls.audience.js';
import type { IcecastClientsClient, MountConnections } from '../../../src/modules/stream/icecast.clients.client.js';
import type { IcecastStatsClient } from '../../../src/modules/stream/icecast.stats.client.js';
import { StreamListenersService } from '../../../src/modules/stream/stream.listeners.service.js';

const T0 = Date.parse('2026-10-28T12:00:00Z');

function service(mounts: MountConnections[], counts: Record<string, number> = {}, hls = new HlsAudience()) {
    const icecast = { connections: async () => mounts } as unknown as IcecastClientsClient;
    const stats = { listenersByMount: () => new Map(Object.entries(counts)) } as unknown as IcecastStatsClient;
    return new StreamListenersService(icecast, stats, hls);
}

describe('StreamListenersService', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(T0);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('lists the Icecast mounts in order, then HLS, each longest-connected first', async () => {
        const hls = new HlsAudience();
        hls.seen({ address: '198.51.100.20', agent: 'AppleCoreMedia/1.0' });
        vi.advanceTimersByTime(7_400);
        hls.seen({ address: '198.51.100.21' });
        hls.seen({ address: '198.51.100.20', agent: 'AppleCoreMedia/1.0' });

        const listeners = await service(
            [
                {
                    mount: '/live.mp3',
                    connections: [
                        { id: '1', address: '203.0.113.1', agent: 'VLC/3.0.21', connectedMs: 5_000 },
                        { id: '2', address: '203.0.113.2', connectedMs: 90_000 },
                    ],
                },
                { mount: '/live.opus', connections: [{ id: '3', address: '2001:db8::5', agent: 'Firefox', connectedMs: 12_000 }] },
            ],
            { '/live.mp3': 2, '/live.opus': 1 },
            hls,
        ).listListeners();

        expect(listeners.readAt.toMillis()).toBe(T0 + 7_400);
        expect(listeners.connections).toEqual([
            { via: 'icecast', mount: '/live.mp3', address: '203.0.113.2', connectedMs: 90_000 },
            { via: 'icecast', mount: '/live.mp3', address: '203.0.113.1', agent: 'VLC/3.0.21', connectedMs: 5_000 },
            { via: 'icecast', mount: '/live.opus', address: '2001:db8::5', agent: 'Firefox', connectedMs: 12_000 },
            // Since the first fetch of this stretch, to the second, as Icecast reports its own.
            { via: 'hls', address: '198.51.100.20', agent: 'AppleCoreMedia/1.0', connectedMs: 7_000 },
            { via: 'hls', address: '198.51.100.21', connectedMs: 0 },
        ]);
        expect(listeners.unreadable).toEqual([]);
        expect(listeners.total).toBe(5);
    });

    it('lists a mount that could not be read apart, and keeps the rest', async () => {
        const listeners = await service([
            { mount: '/live.mp3', connections: [{ id: '1', address: '203.0.113.1', connectedMs: 1_000 }] },
            { mount: '/live.flac', unreadable: 'unanswered' },
        ]).listListeners();

        expect(listeners.connections).toHaveLength(1);
        expect(listeners.unreadable).toEqual([{ mount: '/live.flac', reason: 'unanswered' }]);
    });

    it('reports the station count as it holds it, not the length of the list', async () => {
        // Every mount unreadable and the poll still counting three: the page should show three
        // listeners and nobody it can name, which is the truth, rather than "nobody listening".
        const listeners = await service([{ mount: '/live.mp3', unreadable: 'refused' }], { '/live.mp3': 3 }).listListeners();

        expect(listeners.total).toBe(3);
        expect(listeners.connections).toEqual([]);
        expect(listeners.unreadable).toEqual([{ mount: '/live.mp3', reason: 'refused' }]);
    });

    it('leaves out an HLS player that has stopped asking', async () => {
        const hls = new HlsAudience();
        hls.seen({ address: '198.51.100.20' });
        vi.advanceTimersByTime(HLS_PRESENCE_MS + 1);

        const listeners = await service([{ mount: '/live.mp3', connections: [] }], {}, hls).listListeners();

        expect(listeners.connections).toEqual([]);
        expect(listeners.total).toBe(0);
    });

    it('cuts an agent to the contract ceiling rather than answering something a client would refuse', async () => {
        const agent = `Player/${'x'.repeat(2_000)}`;

        const listeners = await service([
            { mount: '/live.mp3', connections: [{ id: '1', address: '203.0.113.1', agent, connectedMs: 0 }] },
        ]).listListeners();

        expect(listeners.connections[0]?.agent).toHaveLength(512);
    });
});
