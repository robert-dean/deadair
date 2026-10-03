import { vi } from 'vitest';
import type { FakePluginHost, FakePluginTlsSocket } from '@deadair/plugin-sdk/testing';

import { CAST_NS } from '../src/drivers/chromecast/cast.channel.js';
import { DEFAULT_MEDIA_RECEIVER } from '../src/drivers/chromecast/chromecast.driver.js';
import { CastFrameReader, frameCastMessage } from '../src/drivers/chromecast/cast.frame.js';

type Payload = Record<string, unknown>;

interface App {
    appId: string;
    sessionId: string;
    transportId: string;
    displayName: string;
}

/**
 * A Cast device played from the test: it reads what the plugin writes on a `host.tls` connection
 * and answers the way a real one does, on the receiver and media namespaces this plugin uses.
 *
 * State is plain fields so a test can set the scene (another app running, a media player that
 * stopped with a reason) and assert on what the plugin left behind.
 */
export class FakeCastDevice {
    app: App | undefined;
    media: Payload | undefined;
    /** Answers LOAD with LOAD_FAILED instead, for a stream the device cannot play. */
    failLoads = false;
    /** Stops answering anything but leaves the connection open, for a timeout. */
    mute = false;
    /** Every request the plugin sent, as `<namespace>#<type>`. */
    readonly requests: string[] = [];
    /** Every LOAD payload, in order. */
    readonly loads: Payload[] = [];
    socket: FakePluginTlsSocket | undefined;
    private readonly reader = new CastFrameReader();

    /** Attaches to every `host.tls` the plugin opens from now on. */
    static on(host: FakePluginHost): FakeCastDevice {
        const device = new FakeCastDevice();
        host.onTlsOpen(socket => device.attach(socket));
        return device;
    }

    attach(socket: FakePluginTlsSocket): void {
        this.socket = socket;
        vi.mocked(socket.send).mockImplementation(bytes => {
            if (socket.closed) return;
            socket.sent.push(bytes);
            for (const message of this.reader.push(bytes)) {
                if (message.payload === undefined) continue;
                this.handle(message.namespace, message.sourceId, message.destinationId, JSON.parse(message.payload) as Payload);
            }
        });
    }

    /** Puts another app in the foreground, as somebody casting a film would. */
    runOther(displayName = 'Netflix'): void {
        this.app = { appId: 'CA5E8412', sessionId: 'other-session', transportId: 'other-transport', displayName };
        this.media = undefined;
    }

    private handle(namespace: string, sender: string, destination: string, payload: Payload): void {
        if (namespace === CAST_NS.connection) return;
        if (namespace === CAST_NS.heartbeat) {
            if (payload.type === 'PING') this.reply(namespace, destination, sender, { type: 'PONG' });
            return;
        }

        this.requests.push(`${namespace.split('.').at(-1)}#${String(payload.type)}`);
        if (this.mute) return;
        const requestId = payload.requestId;

        if (namespace === CAST_NS.receiver) {
            if (payload.type === 'LAUNCH') {
                this.app = {
                    appId: String(payload.appId),
                    sessionId: 'session-1',
                    transportId: 'transport-1',
                    displayName: 'Default Media Receiver',
                };
                this.media = undefined;
            }
            if (payload.type === 'STOP') {
                this.app = undefined;
                this.media = undefined;
            }
            this.reply(namespace, destination, sender, {
                type: 'RECEIVER_STATUS',
                requestId,
                status: { applications: this.app === undefined ? [] : [this.app] },
            });
            return;
        }

        if (namespace === CAST_NS.media) {
            if (this.app?.appId !== DEFAULT_MEDIA_RECEIVER || destination !== this.app.transportId) {
                this.reply(namespace, destination, sender, { type: 'INVALID_REQUEST', requestId, reason: 'INVALID_COMMAND' });
                return;
            }
            if (payload.type === 'LOAD') {
                this.loads.push(payload);
                if (this.failLoads) {
                    this.reply(namespace, destination, sender, { type: 'LOAD_FAILED', requestId });
                    return;
                }
                this.media = { mediaSessionId: 1, playerState: 'BUFFERING', media: payload.media };
            }
            this.reply(namespace, destination, sender, { type: 'MEDIA_STATUS', requestId, status: this.media === undefined ? [] : [this.media] });
        }
    }

    private reply(namespace: string, sourceId: string, destinationId: string, payload: Payload): void {
        const socket = this.socket;
        queueMicrotask(() => {
            if (socket !== undefined && !socket.closed)
                socket.receive(frameCastMessage({ sourceId, destinationId, namespace, payload: JSON.stringify(payload) }));
        });
    }
}
