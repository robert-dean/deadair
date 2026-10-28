import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';

import { HlsAudience } from './hls.audience.js';
import { IcecastClientsClient } from './icecast.clients.client.js';
import { IcecastStatsClient } from './icecast.stats.client.js';
import type { ListenerConnection, StreamListeners, UnreadableMount } from './types/stream.listeners.types.js';

/** The contract's ceiling on an agent. Longer ones are cut rather than refused, since nobody chose them. */
const AGENT_MAX = 512;
/** The contract's ceiling on an address, which no real IPv4 or IPv6 address reaches. */
const ADDRESS_MAX = 64;

/**
 * Who is listening, connection by connection: the Icecast mounts' own lists and the HLS
 * register, joined into one answer for the operator.
 *
 * Both halves are readings of what is true NOW, which is why this is allowed to exist
 * at all: nothing here is stored, nothing polls, and nothing logs an address. The
 * Icecast half is asked when the request arrives (see {@link IcecastClientsClient}), and
 * the HLS half is the register the heartbeat middleware keeps anyway.
 *
 * `total` is the audience count as the station holds it, not the length of the list,
 * and the two are reported side by side on purpose. They are separate readings (the
 * count comes from the stats poll and the event feed, the list from a request made just
 * now), and one HLS entry can be two players with the same address and agent, so a page
 * showing both lets an operator see a disagreement rather than have it hidden.
 */
@Injectable()
export class StreamListenersService {
    constructor(
        private readonly icecast: IcecastClientsClient,
        private readonly stats: IcecastStatsClient,
        private readonly hls: HlsAudience,
    ) {}

    async listListeners(): Promise<StreamListeners> {
        const mounts = await this.icecast.connections();
        const now = Date.now();

        const connections: ListenerConnection[] = [];
        const unreadable: UnreadableMount[] = [];
        for (const reading of mounts) {
            if ('unreadable' in reading) {
                unreadable.push({ mount: reading.mount, reason: reading.unreadable });
                continue;
            }
            const longestFirst = [...reading.connections].sort((a, b) => b.connectedMs - a.connectedMs);
            for (const connection of longestFirst) {
                connections.push(
                    listenerConnection(
                        { via: 'icecast', mount: reading.mount, address: connection.address, agent: connection.agent },
                        connection.connectedMs,
                    ),
                );
            }
        }
        for (const presence of this.hls.present()) {
            connections.push(listenerConnection({ via: 'hls', address: presence.address, agent: presence.agent }, now - presence.firstSeenAt));
        }

        let icecastTotal = 0;
        for (const count of this.stats.listenersByMount().values()) icecastTotal += count;

        return { readAt: DateTime.fromMillis(now), total: icecastTotal + this.hls.count(), connections, unreadable };
    }
}

function listenerConnection(
    who: { via: ListenerConnection['via']; mount?: string; address: string; agent?: string },
    connectedMs: number,
): ListenerConnection {
    const agent = who.agent?.slice(0, AGENT_MAX);

    return {
        via: who.via,
        ...(who.mount ? { mount: who.mount } : {}),
        address: who.address.slice(0, ADDRESS_MAX),
        ...(agent ? { agent } : {}),
        // To the second, as Icecast keeps it, so the two halves read alike.
        connectedMs: Math.max(0, Math.floor(connectedMs / 1000) * 1000),
    };
}
