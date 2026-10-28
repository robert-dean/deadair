import { Injectable } from 'injectkit';

import { IcecastStatsClient } from './icecast.stats.client.js';
import { connectionsFromListClients, type IcecastConnection } from './icecast.listclients.parse.js';

/**
 * How long one mount's list may take before it reads as unanswered.
 *
 * The stats poll's own figure. This is asked while somebody is looking at a page, so
 * a slow Icecast should cost them a "could not read" on that mount rather than a
 * spinner, and the next refresh asks again.
 */
const LIST_TIMEOUT_MS = 1500;

/** Why a mount's connections could not be read. */
export type UnreadableReason =
    /** The stats poll has not found a 2.5 server with an admin password to ask, or this one is a 2.4. */
    | 'unresolved'
    /** Icecast answered and would not say: a 401 or 403. */
    | 'refused'
    /** Nothing usable came back: a timeout, a refused connection, or a body that was not a client list. */
    | 'unanswered';

/** What one mount said about who is on it. */
export type MountConnections = { mount: string; connections: IcecastConnection[] } | { mount: string; unreadable: UnreadableReason };

/**
 * Who is connected to each of the station's mounts, as Icecast lists them.
 *
 * The count is `IcecastStatsClient`'s, and this is the list behind it: one row per
 * connection, with the address and the player Icecast recorded. It is read ON DEMAND,
 * for somebody looking, and is never polled, stored or logged, because what it
 * carries is listeners' addresses and nothing in the station needs them to run.
 *
 * It asks the server the stats poll has already found, with the admin password the
 * poll already holds, through {@link IcecastStatsClient.adminApi} — the event feed's
 * rule, since two sets of probes would be two answers about which Icecast is there.
 * The admin password is enough for this mount-scoped command because every mount
 * block declares its own credentials: measured on 2.5.0 against the committed
 * config, admin and the mount's own source credential both answer 200. Before the
 * mounts carried credentials, both were 401 ([icecast-2.5](https://github.com/robert-dean/deadair/discussions/17)).
 *
 * **One mount that will not answer costs that mount and not the others.** Each is
 * asked on its own and reported on its own, and "could not read" is never folded
 * into an empty list, for the reason the stats client keeps `undefined` apart from
 * zero: nobody on a mount and not knowing who is on it are opposite facts.
 */
@Injectable()
export class IcecastClientsClient {
    constructor(private readonly stats: IcecastStatsClient) {}

    /** Every mount the station serves, primary first, each with its connections or why they could not be read. */
    async connections(): Promise<MountConnections[]> {
        const mounts = this.stats.mountPaths();
        const api = this.stats.adminApi();
        if (!api) return mounts.map(mount => ({ mount, unreadable: 'unresolved' }));

        return Promise.all(mounts.map(mount => this.read(api, mount)));
    }

    private async read(api: { base: string; password: string }, mount: string): Promise<MountConnections> {
        try {
            const response = await fetch(`${api.base}/admin/listclients.json?mount=${encodeURIComponent(mount)}`, {
                signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
                headers: { authorization: `Basic ${Buffer.from(`admin:${api.password}`).toString('base64')}` },
            });
            if (response.status === 401 || response.status === 403) return { mount, unreadable: 'refused' };
            // A mount with no source is not in Icecast's list of sources, and is answered 404.
            // Nobody can be listening to it, so that is an empty room, exactly as the stats
            // document's silence about such a mount is read as zero.
            if (response.status === 404) return { mount, connections: [] };
            if (!response.ok) return { mount, unreadable: 'unanswered' };

            const connections = connectionsFromListClients((await response.json()) as unknown, mount);
            return connections ? { mount, connections } : { mount, unreadable: 'unanswered' };
        } catch {
            // Timed out, refused, unresolvable, or a body that is not JSON. Not logged: the
            // caller reports it, and a line here would be one per refresh of an open page.
            return { mount, unreadable: 'unanswered' };
        }
    }
}
