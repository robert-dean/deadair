/**
 * Bytes, crossing a boundary that only carries JSON.
 *
 * Everything here is JSON-safe under the same rule as `plugin.host.ts`: no
 * `Uint8Array`, no streams, no live objects. That is why {@link StreamChunk.data}
 * is a base64 `string` and not a byte array — see
 * `docs/decisions/plugin-streaming.md`, which specified this protocol and states
 * the reasoning. The 33% inflation is paid only on a path that is by
 * construction the exceptional one.
 *
 * Two halves, deliberately symmetric:
 *
 * - {@link PluginStreams} is the HOST's, reached as `host.streams`. A plugin
 *   uses it to pull a response body that is too large, or too open-ended, to
 *   arrive whole through `host.fetch`.
 * - {@link PluginStreamSource} is the PLUGIN's. A capability that produces bytes
 *   returns a handle instead of the bytes, and the host pulls them the same way.
 *
 * The plugin half is not named for any one capability on purpose. Speech is its
 * first implementer and should not be its last: an LLM capability streaming
 * tokens wants exactly this and should extend this interface rather than
 * inventing `readTokens`. One stream table per plugin instance, one
 * close-on-dispose rule, however many capabilities produce bytes.
 *
 * ## Pull, never push
 *
 * The reader asks for the next chunk and the writer reads exactly that much.
 * This is the only backpressure story that survives an IPC boundary without
 * inventing a credit protocol, and pulling gets it for free.
 *
 * It is also what makes cancellation a message rather than an object. There is
 * no `AbortSignal` anywhere in this file, and there cannot be one: a signal is a
 * live object with listeners, so it would work in-process today and break the
 * day plugins move behind a subprocess. {@link PluginStreams.close} and
 * {@link PluginStreamSource.closeStream} ARE the cancel, and being pull-based is
 * what makes that sufficient — neither side ever has anything in flight the
 * other cannot stop by declining to read again.
 */

import type { HostFetchInit } from './plugin.host.js';

/** One piece of a stream. */
export interface StreamChunk {
    /**
     * 0-based, strictly increasing. Lets a reader detect a gap it should never
     * see, which is the kind of bug that otherwise surfaces as a corrupt file
     * much later.
     */
    seq: number;

    /** base64. Absent on the terminal chunk, and only there. */
    data?: string;

    /** True on the last chunk. No further read will succeed. */
    done: boolean;
}

/** Handle to an open response body. `streamId` is opaque to the plugin. */
export interface HostStreamOpen {
    streamId: string;

    status: number;

    /** Lowercased header names, exactly as `HostFetchResponse.headers`. */
    headers: Record<string, string>;

    ok: boolean;

    /**
     * Where the response actually came from: the last hop of the redirect chain,
     * which is not necessarily what was asked for.
     */
    url: string;
}

/** A {@link StreamChunk} tagged with the host stream it belongs to. */
export interface HostStreamChunk extends StreamChunk {
    streamId: string;
}

/**
 * The host's byte egress, reached as `host.streams`.
 *
 * Reach for it only when the body genuinely should not arrive whole:
 * `host.fetch` is simpler, is what almost every upstream needs, and its size cap
 * is a feature rather than a limitation for anything that parses as JSON.
 *
 * Egress policy is identical to `host.fetch`'s and nothing about streaming
 * relaxes it: `open` costs one rate-limit point, clears the manifest's hostname
 * allowlist on every redirect hop, and strips credentials across an origin
 * change. `read` costs nothing, because charging per read against a
 * requests-per-second budget would make any file larger than a few hundred
 * kilobytes impossible; a stream is bounded by its byte cap and its lifetime
 * instead.
 *
 * Requires no permission of its own. A stream is an egress, gated by
 * `permissions.network` like any other.
 */
export interface PluginStreams {
    /**
     * Start a request and keep its body open.
     *
     * Bounded by the current invocation's deadline exactly as `host.fetch` is:
     * this covers connect, headers and the whole redirect chain, and nothing
     * more. The reads that follow are bounded separately, which is the point —
     * a legitimate large body outlives the call that opened it.
     *
     * @throws {PluginError} with the same codes `host.fetch` uses: `forbidden`
     *   for a hostname the manifest never declared, `config` for a URL that is
     *   not http(s), `rate_limited`, `timeout`, `upstream`. Also `unavailable`
     *   when this plugin already holds as many open streams as the host allows.
     */
    open(url: string, init?: HostFetchInit): Promise<HostStreamOpen>;

    /**
     * The next chunk. Resolves with `done: true` and no `data` once the body has
     * been read to the end; reading past that is an error, not another `done`.
     *
     * `maxBytes` caps the DECODED size of this chunk. A larger piece off the
     * socket is held and handed back by the next read rather than being dropped,
     * so a small `maxBytes` costs round trips and never bytes.
     *
     * @throws {PluginError} `not_found` for a stream that was closed or never
     *   existed, `timeout` when nothing arrives before the idle deadline or the
     *   stream outlives its lifetime cap, `upstream` when it exceeds its byte cap
     *   or the connection fails. A transport failure rejects the pending read
     *   rather than resolving a chunk carrying an error field, so a plugin that
     *   ignores errors fails loudly instead of silently truncating.
     */
    read(streamId: string, maxBytes?: number): Promise<HostStreamChunk>;

    /**
     * Give up the stream and release the socket.
     *
     * Idempotent, so it can always be called from a `finally`, and closing a
     * stream that already ended is not an error. The host closes every stream a
     * plugin still holds when the plugin is disposed, so one can never outlive
     * the instance that opened it — but that is a backstop for a crash, not the
     * plugin's licence to leak.
     */
    close(streamId: string): Promise<void>;
}

/**
 * A plugin that produces bytes the host pulls, whatever the bytes are.
 *
 * A capability whose result is too large to return whole returns a handle
 * carrying a `streamId` instead, and the host drains it through these two
 * methods. The usual implementation forwards to an open {@link PluginStreams}
 * read, which is what makes the whole path stream end to end: the bytes exist
 * whole in neither process.
 *
 * `streamId` is the plugin's own, and unrelated to any host stream id it may be
 * wrapping. Keep the two apart in a map; handing the host's id back to the host
 * happens to work in-process today and is exactly the sort of thing that stops
 * working behind IPC.
 */
export interface PluginStreamSource {
    /**
     * The next chunk of one of this plugin's streams, following the same rules
     * as {@link PluginStreams.read}: `done: true` with no `data` at the end,
     * `maxBytes` caps the decoded chunk size, and a failure rejects rather than
     * resolving something that looks like data.
     *
     * @throws {PluginError} `not_found` for a stream this plugin does not have
     *   open. That code rather than `internal`, because a closed stream is a
     *   statement about the thing asked for and not evidence the plugin is sick
     *   (see `isResourceScopedCode`).
     */
    readStream(streamId: string, maxBytes?: number): Promise<StreamChunk>;

    /**
     * Release one of this plugin's streams, and whatever it was holding open.
     *
     * Must be idempotent: the host calls it from a `finally`, so it will be
     * called on a stream that already ended normally.
     */
    closeStream(streamId: string): Promise<void>;
}
