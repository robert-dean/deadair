import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * One connection to the station's stream, as it stands at the moment of reading
 * generated from [ListenerConnection](../../../../data/contracts/stream/stream.listeners.types.ck)
 */
export const ListenerConnection = z.strictObject({
    via: z
        .enum(['icecast', 'hls'])
        .describe(
            '`icecast` is a player holding a connection open on a mount. `hls` is a player re-fetching a playlist, counted while it keeps asking',
        ),
    mount: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe('The Icecast mount it is on, such as `/live.mp3`. Absent over HLS, whose players are counted across every playlist together'),
    address: z
        .string()
        .min(1)
        .max(64)
        .describe(
            "The address the station recorded. A listener's own only where the edge in front of the station is trusted to say so; behind a tunnel without `REAL_IP_FROM` it is the tunnel's",
        ),
    agent: z.string().min(1).max(512).optional().describe('What the player said it was, cut to 512 characters. Absent when it sent nothing'),
    connectedMs: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe('How long it has been connected, to the second. Over HLS, since the first playlist fetch of this stretch of listening'),
});
export type ListenerConnection = z.infer<typeof ListenerConnection>;

/**
 * An Icecast mount whose connections could not be read, so its listeners are missing from the list
 * generated from [UnreadableMount](../../../../data/contracts/stream/stream.listeners.types.ck)
 */
export const UnreadableMount = z.strictObject({
    mount: z.string().min(1).max(200),
    reason: z
        .enum(['unresolved', 'refused', 'unanswered'])
        .describe(
            '`unresolved`: the station has not yet found an Icecast 2.5 it can ask. `refused`: Icecast answered 401 or 403. `unanswered`: a timeout, a failed connection, or a reply that was not a client list',
        ),
});
export type UnreadableMount = z.infer<typeof UnreadableMount>;

/**
 * Who is connected to the station's stream right now. Read on request and never stored
 * generated from [StreamListeners](../../../../data/contracts/stream/stream.listeners.types.ck)
 */
export const StreamListeners = z.strictObject({
    readAt: _ZodDatetime.describe('When this was read'),
    total: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe(
            "The audience count the station is acting on, the same figure as the console's tally. It can differ from the number of connections: it is kept by a separate reading, and one HLS entry can stand for two players with the same address and agent",
        ),
    connections: z
        .array(ListenerConnection)
        .describe("Every connection that could be read, Icecast mounts first in the station's mount order, then HLS, each longest-connected first"),
    unreadable: z
        .array(UnreadableMount)
        .describe('The mounts that could not be read. Empty when every one was. A mount listed here is not an empty mount'),
});
export type StreamListeners = z.infer<typeof StreamListeners>;
