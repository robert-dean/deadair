import { PluginError, type PluginHost, type PluginTlsSocket } from '@deadair/plugin-sdk';

import { CastFrameReader, frameCastMessage } from './cast.frame.js';
import type { CastMessage } from './cast.message.js';

/** The four namespaces this plugin speaks. Every payload on them is JSON. */
export const CAST_NS = {
    connection: 'urn:x-cast:com.google.cast.tp.connection',
    heartbeat: 'urn:x-cast:com.google.cast.tp.heartbeat',
    receiver: 'urn:x-cast:com.google.cast.receiver',
    media: 'urn:x-cast:com.google.cast.media',
} as const;

/** Who this end is, and the platform's own end, which owns launching and stopping apps. */
export const CAST_SENDER_ID = 'sender-0';
export const CAST_RECEIVER_ID = 'receiver-0';

/** How often a PING goes out. The device drops a sender it has not heard from in a few of these. */
export const CAST_HEARTBEAT_MS = 5_000;

/** How long without hearing ANYTHING before the connection is taken for dead and closed. */
export const CAST_SILENCE_MS = 3 * CAST_HEARTBEAT_MS;

/** The longest one request waits for its answer when the caller does not say. */
export const CAST_REQUEST_TIMEOUT_MS = 8_000;

/** A JSON payload, as the device sends it. */
export type CastPayload = Record<string, unknown>;

/** Answers that mean the request failed, whatever namespace they came on. */
const FAILURE_TYPES = new Set(['LAUNCH_ERROR', 'INVALID_REQUEST', 'LOAD_FAILED', 'LOAD_CANCELLED', 'INVALID_PLAYER_STATE']);

interface Pending {
    resolve: (payload: CastPayload) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

/**
 * One control connection to one Cast device.
 *
 * A Cast device multiplexes "virtual connections" over its one TLS connection: the platform's own
 * `receiver-0`, and one per app session, addressed by the app's `transportId`. Each has to be
 * CONNECTed before it will answer, which {@link request} does the first time it addresses one.
 * Requests carry a `requestId` and the answer echoes it, which is how an answer is matched to its
 * question here; anything that arrives without one (a status broadcast) is ignored, because this
 * plugin always asks rather than listens.
 *
 * The connection is the plugin's, not a call's: it is opened lazily by the driver, kept for later
 * calls, and closed when the device goes quiet, hangs up or the plugin is disposed.
 */
export class CastChannel {
    private readonly reader = new CastFrameReader();
    private readonly pending = new Map<number, Pending>();
    private readonly connected = new Set<string>();
    private readonly closeListeners: (() => void)[] = [];
    private nextRequestId = 1;
    private lastHeardAt = Date.now();
    private heartbeat: ReturnType<typeof setInterval> | undefined;
    private shut = false;

    private constructor(
        private readonly socket: PluginTlsSocket,
        private readonly label: string,
        private readonly host: PluginHost,
    ) {}

    /**
     * Opens the connection and CONNECTs to the platform's receiver. `url` is `tls://host:port`;
     * `label` is how the device is named in errors and the log, which defaults to the URL. And
     * the certificate is not verified: a Cast device's chains to Google's device CA, which no
     * system trust store holds, and the address is one the operator typed in.
     */
    static async open(host: PluginHost, url: string, options: { label?: string; connectTimeoutMs?: number } = {}): Promise<CastChannel> {
        const { label = url, connectTimeoutMs } = options;
        const socket = await host.tls(url, { verifyCertificate: false, ...(connectTimeoutMs === undefined ? {} : { connectTimeoutMs }) });
        const channel = new CastChannel(socket, label, host);
        channel.start();
        return channel;
    }

    /** Whether it has closed, for either end's reason. A closed channel is replaced, never reopened. */
    get closed(): boolean {
        return this.shut;
    }

    /** Told once, when it closes for any reason. */
    onClose(listener: () => void): void {
        if (this.shut) queueMicrotask(listener);
        else this.closeListeners.push(listener);
    }

    /**
     * Sends a request and waits for the answer that echoes its `requestId`.
     *
     * Rejects with a `PluginError`: `upstream` for an answer that says the request failed
     * (`LOAD_FAILED`, `LAUNCH_ERROR` and the like, named in the message), `timeout` when nothing
     * came back in time, and `unavailable` when the connection closed first.
     */
    request(namespace: string, destinationId: string, payload: CastPayload, timeoutMs = CAST_REQUEST_TIMEOUT_MS): Promise<CastPayload> {
        if (this.shut) return Promise.reject(this.closedError());
        this.ensureConnected(destinationId);

        const requestId = this.nextRequestId++;
        return new Promise<CastPayload>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new PluginError(`${this.label} did not answer ${String(payload.type)} within ${timeoutMs}ms`).withCode('timeout'));
            }, timeoutMs);
            this.pending.set(requestId, { resolve, reject, timer });
            this.write(namespace, destinationId, { ...payload, requestId });
        });
    }

    /** Sends a message that has no answer. */
    send(namespace: string, destinationId: string, payload: CastPayload): void {
        if (this.shut) return;
        this.ensureConnected(destinationId);
        this.write(namespace, destinationId, payload);
    }

    /** Closes it, telling the device first where it can. Safe to call twice. */
    close(): void {
        if (this.shut) return;
        for (const destinationId of this.connected) this.write(CAST_NS.connection, destinationId, { type: 'CLOSE' });
        this.socket.close();
        this.finish();
    }

    private start(): void {
        this.socket.onData(chunk => this.receive(chunk));
        this.socket.onClose(reason => {
            if (reason !== undefined) this.host.logger.debug('cast connection closed', { device: this.label, reason });
            this.finish();
        });
        this.ensureConnected(CAST_RECEIVER_ID);
        this.heartbeat = setInterval(() => {
            if (Date.now() - this.lastHeardAt > CAST_SILENCE_MS) {
                this.host.logger.debug('cast device went quiet; closing', { device: this.label });
                this.close();
                return;
            }
            this.write(CAST_NS.heartbeat, CAST_RECEIVER_ID, { type: 'PING' });
        }, CAST_HEARTBEAT_MS);
    }

    private ensureConnected(destinationId: string): void {
        if (this.connected.has(destinationId)) return;
        this.connected.add(destinationId);
        this.write(CAST_NS.connection, destinationId, { type: 'CONNECT' });
    }

    private write(namespace: string, destinationId: string, payload: CastPayload): void {
        this.socket.send(frameCastMessage({ sourceId: CAST_SENDER_ID, destinationId, namespace, payload: JSON.stringify(payload) }));
    }

    private receive(chunk: Uint8Array): void {
        this.lastHeardAt = Date.now();
        let messages: CastMessage[];
        try {
            messages = this.reader.push(chunk);
        } catch (error) {
            this.host.logger.warn('cast connection out of step; closing', { device: this.label, error: (error as Error).message });
            this.close();
            return;
        }
        for (const message of messages) this.handle(message);
    }

    private handle(message: CastMessage): void {
        if (message.payload === undefined) return;
        let payload: CastPayload;
        try {
            const parsed: unknown = JSON.parse(message.payload);
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
            payload = parsed as CastPayload;
        } catch {
            return;
        }

        if (message.namespace === CAST_NS.heartbeat) {
            if (payload.type === 'PING') this.write(CAST_NS.heartbeat, message.sourceId, { type: 'PONG' });
            return;
        }
        if (message.namespace === CAST_NS.connection && payload.type === 'CLOSE') {
            // The device ended one virtual connection, usually an app session that stopped. The
            // next request to it CONNECTs again.
            this.connected.delete(message.sourceId);
            return;
        }

        const requestId = typeof payload.requestId === 'number' ? payload.requestId : undefined;
        if (requestId === undefined || requestId === 0) return;
        const waiting = this.pending.get(requestId);
        if (waiting === undefined) return;
        this.pending.delete(requestId);
        clearTimeout(waiting.timer);

        const type = typeof payload.type === 'string' ? payload.type : '';
        if (FAILURE_TYPES.has(type)) {
            const reason = typeof payload.reason === 'string' ? ` (${payload.reason})` : '';
            waiting.reject(new PluginError(`${this.label} answered ${type}${reason}`).withCode('upstream'));
            return;
        }
        waiting.resolve(payload);
    }

    private finish(): void {
        if (this.shut) return;
        this.shut = true;
        clearInterval(this.heartbeat);
        for (const [, waiting] of this.pending) {
            clearTimeout(waiting.timer);
            waiting.reject(this.closedError());
        }
        this.pending.clear();
        for (const listener of this.closeListeners.splice(0)) listener();
    }

    private closedError(): PluginError {
        return new PluginError(`the connection to ${this.label} closed`).withCode('unavailable');
    }
}
