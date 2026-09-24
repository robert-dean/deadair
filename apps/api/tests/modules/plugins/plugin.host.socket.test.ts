import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPluginError, type PluginError, type PluginErrorCode, type PluginManifest } from '@deadair/plugin-sdk';

import {
    PLUGIN_SOCKET_CONNECT_TIMEOUT_MS,
    PLUGIN_SOCKET_MAX_FRAME_BYTES,
    PLUGIN_SOCKET_MAX_OPEN,
    PluginHostFactory,
    PluginHostFactoryOptions,
    type HostWebSocket,
} from '../../../src/modules/plugins/plugin.host.factory.js';
import { NETWORK_OPEN, type AddressResolver } from '../../../src/modules/plugins/plugin.grants.js';
import type { PluginGrantsService } from '../../../src/modules/plugins/plugin.grants.service.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';
import { stubShimClient } from '../../utils/spotify.shim.fixture.js';
import { stubContainer } from '../../utils/stub.container.js';

/**
 * `host.socket`: the fetch policy applied to an outbound WebSocket, and the bounds that stand in for
 * a deadline on something meant to outlive the call that opened it.
 */
const PLUGIN_ID = 'test.sockets';

type Listener = (event: { data?: unknown; code?: number; reason?: string }) => void;

/** A platform socket the test plays the far end of. */
class FakeWebSocket implements HostWebSocket {
    readonly sent: string[] = [];
    readonly closes: { code?: number; reason?: string }[] = [];
    private readonly listeners = new Map<string, Listener[]>();

    constructor(readonly url: string) {}

    send(data: string): void {
        this.sent.push(data);
    }

    close(code?: number, reason?: string): void {
        this.closes.push({ code, reason });
    }

    addEventListener(type: string, listener: Listener): void {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }

    emit(type: 'open' | 'message' | 'close' | 'error', event: { data?: unknown; code?: number; reason?: string } = {}): void {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
}

function manifest(permissions: Partial<PluginManifest['permissions']> = {}): PluginManifest {
    return {
        id: PLUGIN_ID,
        name: 'Socket Plugin',
        version: '1.0.0',
        capabilities: ['messaging'],
        apiVersion: '^1.0.0',
        permissions: { network: ['gateway.example.com'], storage: false, oauth: false, sockets: true, ...permissions },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
    };
}

const resolvesTo = new Map<string, string[]>();
const resolving: AddressResolver = vi.fn(async (hostname: string) => resolvesTo.get(hostname) ?? ['93.184.216.34']);

function setup(grantOpen = false) {
    const opened: FakeWebSocket[] = [];
    const openWebSocket = vi.fn((url: string) => {
        const socket = new FakeWebSocket(url);
        opened.push(socket);
        return socket;
    });
    const grants = { holds: (_id: string, capability: string) => grantOpen && capability === NETWORK_OPEN } as unknown as PluginGrantsService;
    const pluginLog = stubPluginLog();
    const factory = new PluginHostFactory(
        new PluginHostFactoryOptions('https://host.example', resolving, openWebSocket),
        stubContainer([]).container,
        pluginLog.log,
        stubShimClient(),
        grants,
    );
    return { factory, opened, openWebSocket, logger: pluginLog.scoped };
}

async function refusal(call: Promise<unknown>): Promise<PluginError> {
    const error = await call.then(
        () => undefined,
        (caught: unknown) => caught,
    );
    if (!isPluginError(error)) throw new Error(`expected a PluginError, got ${String(error)}`);
    return error;
}

/** Opens a socket and lets the far end accept it. */
async function openSocket(harness: ReturnType<typeof setup>, url = 'wss://gateway.example.com/?v=10') {
    const host = harness.factory.createHost(manifest());
    const pending = host.socket(url);
    await vi.waitFor(() => expect(harness.opened.length).toBeGreaterThan(0));
    const raw = harness.opened.at(-1) as FakeWebSocket;
    raw.emit('open');
    return { host, socket: await pending, raw };
}

afterEach(() => {
    vi.useRealTimers();
    resolvesTo.clear();
});

describe('PluginHostFactory host.socket', () => {
    it('refuses a plugin that did not declare the permission', async () => {
        const { factory, openWebSocket } = setup();
        const host = factory.createHost(manifest({ sockets: undefined }));

        const error = await refusal(host.socket('wss://gateway.example.com/'));

        expect(error.code).toBe<PluginErrorCode>('internal');
        expect(openWebSocket).not.toHaveBeenCalled();
    });

    it.each(['ws://gateway.example.com/', 'https://gateway.example.com/', 'not a url'])('refuses %s: wss only', async url => {
        const { factory, openWebSocket } = setup();

        const error = await refusal(factory.createHost(manifest()).socket(url));

        expect(error.code).toBe<PluginErrorCode>('config');
        expect(openWebSocket).not.toHaveBeenCalled();
    });

    it('holds a socket to the same allowlist as fetch', async () => {
        const { factory, openWebSocket } = setup();

        const error = await refusal(factory.createHost(manifest()).socket('wss://elsewhere.example.net/'));

        expect(error.code).toBe<PluginErrorCode>('forbidden');
        expect(openWebSocket).not.toHaveBeenCalled();
    });

    it('refuses a host reached through network.open that resolves to a private address', async () => {
        const { factory, openWebSocket } = setup(true);
        resolvesTo.set('sneaky.example.net', ['10.0.0.5']);
        const host = factory.createHost(
            manifest({ network: [], grants: [{ capability: NETWORK_OPEN, reason: 'Connects wherever the platform says.' }] }),
        );

        const error = await refusal(host.socket('wss://sneaky.example.net/'));

        expect(error.code).toBe<PluginErrorCode>('forbidden');
        expect(openWebSocket).not.toHaveBeenCalled();
    });

    it('opens the wss URL it was given, and resolves only once the socket is open', async () => {
        const harness = setup();
        const host = harness.factory.createHost(manifest());
        let settled = false;
        const pending = host.socket('wss://gateway.example.com/?v=10&encoding=json').then(socket => {
            settled = true;
            return socket;
        });

        await vi.waitFor(() => expect(harness.opened).toHaveLength(1));
        expect(harness.opened[0]?.url).toBe('wss://gateway.example.com/?v=10&encoding=json');
        await Promise.resolve();
        expect(settled).toBe(false);

        harness.opened[0]?.emit('open');
        await expect(pending).resolves.toBeDefined();
    });

    it('passes text frames both ways, and drops a binary one', async () => {
        const harness = setup();
        const { socket, raw } = await openSocket(harness);
        const received: string[] = [];
        socket.onMessage(text => received.push(text));

        socket.send('{"op":1}');
        raw.emit('message', { data: '{"op":11}' });
        raw.emit('message', { data: new ArrayBuffer(4) });

        expect(raw.sent).toEqual(['{"op":1}']);
        expect(received).toEqual(['{"op":11}']);
    });

    it('tells close listeners the code, including one registered after the close', async () => {
        const harness = setup();
        const { socket, raw } = await openSocket(harness);
        const early = vi.fn();
        socket.onClose(early);

        raw.emit('close', { code: 4000, reason: 'resume' });
        const late = vi.fn();
        socket.onClose(late);
        await Promise.resolve();

        expect(early).toHaveBeenCalledWith(4000, 'resume');
        expect(late).toHaveBeenCalledWith(4000, 'resume');
    });

    it('ignores a send after the socket closed rather than throwing', async () => {
        const harness = setup();
        const { socket, raw } = await openSocket(harness);
        raw.emit('close', { code: 1006 });

        expect(() => socket.send('late heartbeat')).not.toThrow();
        expect(raw.sent).toEqual([]);
    });

    it('closes with 1000 when asked for a code a client may not send', async () => {
        const harness = setup();
        const { socket, raw } = await openSocket(harness);

        socket.close(1009, 'no');
        socket.close(4000, 'resume');

        expect(raw.closes).toEqual([
            { code: 1000, reason: 'no' },
            { code: 4000, reason: 'resume' },
        ]);
    });

    it('closes a socket that sends a frame over the size limit', async () => {
        const harness = setup();
        const { socket, raw } = await openSocket(harness);
        const received = vi.fn();
        const closed = vi.fn();
        socket.onMessage(received);
        socket.onClose(closed);

        raw.emit('message', { data: 'x'.repeat(PLUGIN_SOCKET_MAX_FRAME_BYTES + 1) });

        expect(received).not.toHaveBeenCalled();
        expect(raw.closes[0]?.code).toBe(3009);
        expect(closed).toHaveBeenCalledWith(3009, 'frame too large');
    });

    it('keeps a listener that throws from reaching the event loop', async () => {
        const harness = setup();
        const { socket, raw } = await openSocket(harness);
        const after = vi.fn();
        socket.onMessage(() => {
            throw new Error('plugin bug');
        });
        socket.onMessage(after);

        expect(() => raw.emit('message', { data: 'hello' })).not.toThrow();
        expect(after).toHaveBeenCalledWith('hello');
        expect(harness.logger.warn).toHaveBeenCalled();
    });

    it('rejects a socket that closes before it opens', async () => {
        const harness = setup();
        const pending = harness.factory.createHost(manifest()).socket('wss://gateway.example.com/');
        await vi.waitFor(() => expect(harness.opened).toHaveLength(1));

        harness.opened[0]?.emit('close', { code: 1006 });

        expect((await refusal(pending)).code).toBe<PluginErrorCode>('upstream');
    });

    it('gives up on a socket that never opens', async () => {
        vi.useFakeTimers();
        const harness = setup();
        const pending = harness.factory.createHost(manifest()).socket('wss://gateway.example.com/');
        const caught = refusal(pending);
        await vi.waitFor(() => expect(harness.opened).toHaveLength(1));

        await vi.advanceTimersByTimeAsync(PLUGIN_SOCKET_CONNECT_TIMEOUT_MS);

        expect((await caught).code).toBe<PluginErrorCode>('timeout');
        expect(harness.opened[0]?.closes).toHaveLength(1);
    });

    it('refuses more than the open-socket cap, and makes room when one closes', async () => {
        const harness = setup();
        const host = harness.factory.createHost(manifest());
        const sockets = [];
        for (let i = 0; i < PLUGIN_SOCKET_MAX_OPEN; i++) {
            const pending = host.socket('wss://gateway.example.com/');
            await vi.waitFor(() => expect(harness.opened).toHaveLength(i + 1));
            harness.opened[i]?.emit('open');
            sockets.push(await pending);
        }

        expect((await refusal(host.socket('wss://gateway.example.com/'))).code).toBe<PluginErrorCode>('internal');

        harness.opened[0]?.emit('close', { code: 1000 });
        const pending = host.socket('wss://gateway.example.com/');
        await vi.waitFor(() => expect(harness.opened).toHaveLength(PLUGIN_SOCKET_MAX_OPEN + 1));
        harness.opened.at(-1)?.emit('open');
        await expect(pending).resolves.toBeDefined();
    });

    it('closes every socket on dispose without telling the plugin, and refuses any more', async () => {
        const harness = setup();
        const { host, socket, raw } = await openSocket(harness);
        const closed = vi.fn();
        socket.onClose(closed);

        harness.factory.closeOpenSockets(PLUGIN_ID);
        raw.emit('close', { code: 1000 });

        expect(raw.closes).toEqual([{ code: 1000, reason: 'plugin disposed' }]);
        expect(closed).not.toHaveBeenCalled();
        expect((await refusal(host.socket('wss://gateway.example.com/'))).code).toBe<PluginErrorCode>('unavailable');
    });

    it('closes a socket that finishes opening after its plugin was disposed', async () => {
        const harness = setup();
        const pending = harness.factory.createHost(manifest()).socket('wss://gateway.example.com/');
        await vi.waitFor(() => expect(harness.opened).toHaveLength(1));

        harness.factory.closeOpenSockets(PLUGIN_ID);
        harness.opened[0]?.emit('open');

        expect((await refusal(pending)).code).toBe<PluginErrorCode>('upstream');
        expect(harness.opened[0]?.closes).toHaveLength(1);
    });

    it('is safe to close for a plugin that never opened one, and twice', () => {
        const { factory } = setup();
        factory.createHost(manifest());

        expect(() => factory.closeOpenSockets(PLUGIN_ID)).not.toThrow();
        expect(() => factory.closeOpenSockets(PLUGIN_ID)).not.toThrow();
        expect(() => factory.closeOpenSockets('never.existed')).not.toThrow();
    });
});
