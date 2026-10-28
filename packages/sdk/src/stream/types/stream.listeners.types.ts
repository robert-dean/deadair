import { DateTime } from 'luxon';
const __dt = (v: unknown, path: string): DateTime => {
    if (typeof v !== 'string') {
        throw new TypeError(`ContractKit: expected an ISO 8601 string at '${path}', received ${typeof v}.`);
    }
    const d = DateTime.fromISO(v);
    if (!d.isValid) throw new TypeError(`ContractKit: '${v}' at '${path}' is not a valid ISO 8601 datetime.`);
    return d;
};

/**
 * One connection to the station's stream, as it stands at the moment of reading
 * generated from [ListenerConnection](../../../../../apps/api/data/contracts/stream/stream.listeners.types.ck)
 */
export interface ListenerConnection {
    /** `icecast` is a player holding a connection open on a mount. `hls` is a player re-fetching a playlist, counted while it keeps asking */
    via: 'icecast' | 'hls';
    /** The Icecast mount it is on, such as `/live.mp3`. Absent over HLS, whose players are counted across every playlist together */
    mount?: string;
    /** The address the station recorded. A listener's own only where the edge in front of the station is trusted to say so; behind a tunnel without `REAL_IP_FROM` it is the tunnel's */
    address: string;
    /** What the player said it was, cut to 512 characters. Absent when it sent nothing */
    agent?: string;
    /** How long it has been connected, to the second. Over HLS, since the first playlist fetch of this stretch of listening */
    connectedMs: number;
}

/**
 * An Icecast mount whose connections could not be read, so its listeners are missing from the list
 * generated from [UnreadableMount](../../../../../apps/api/data/contracts/stream/stream.listeners.types.ck)
 */
export interface UnreadableMount {
    mount: string;
    /** `unresolved`: the station has not yet found an Icecast 2.5 it can ask. `refused`: Icecast answered 401 or 403. `unanswered`: a timeout, a failed connection, or a reply that was not a client list */
    reason: 'unresolved' | 'refused' | 'unanswered';
}

/**
 * Who is connected to the station's stream right now. Read on request and never stored
 * generated from [StreamListeners](../../../../../apps/api/data/contracts/stream/stream.listeners.types.ck)
 */
export interface StreamListeners {
    /** When this was read */
    readAt: DateTime;
    /** The audience count the station is acting on, the same figure as the console's tally. It can differ from the number of connections: it is kept by a separate reading, and one HLS entry can stand for two players with the same address and agent */
    total: number;
    /** Every connection that could be read, Icecast mounts first in the station's mount order, then HLS, each longest-connected first */
    connections: ListenerConnection[];
    /** The mounts that could not be read. Empty when every one was. A mount listed here is not an empty mount */
    unreadable: UnreadableMount[];
}

/** Rehydrates every wire-encoded scalar in a StreamListeners into its runtime type. Mutates and returns `raw`. */
export function reviveStreamListeners(raw: StreamListeners): StreamListeners {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['readAt'] = __dt(__o0['readAt'], 'StreamListeners.readAt');
    return raw;
}
