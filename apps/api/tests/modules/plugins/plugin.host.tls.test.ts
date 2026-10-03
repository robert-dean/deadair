import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:tls';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { isPluginError, type ConfigField, type PluginError, type PluginErrorCode, type PluginManifest } from '@deadair/plugin-sdk';

import {
    PLUGIN_TLS_MAX_OPEN,
    PluginHostFactory,
    PluginHostFactoryOptions,
    type HostTlsConnection,
    type HostTlsOpener,
    type HostTlsTarget,
} from '../../../src/modules/plugins/plugin.host.factory.js';
import { PluginConfigService } from '../../../src/modules/plugins/plugin.config.service.js';
import { NETWORK_OPEN, type AddressResolver } from '../../../src/modules/plugins/plugin.grants.js';
import type { PluginGrantsService } from '../../../src/modules/plugins/plugin.grants.service.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';
import { stubShimClient } from '../../utils/spotify.shim.fixture.js';
import { stubContainer } from '../../utils/stub.container.js';

/**
 * `host.tls`: the socket policy applied to a raw TLS connection, and the one exemption it adds, a
 * certificate nobody signed on a device the operator typed in.
 *
 * The round trip at the bottom is the one place a real `node:tls` is touched. Its certificate is
 * self-signed for 127.0.0.1 and made by `openssl` when the suite runs, rather than committed: the
 * repository ignores `*.pem` so that no key ever lands in it, and a test is no reason to start.
 */
const PLUGIN_ID = 'test.tls';

/** A connection the test plays the device end of. */
class FakeTlsConnection extends EventEmitter implements HostTlsConnection {
    readonly written: Uint8Array[] = [];
    destroyed = false;

    constructor(readonly target: HostTlsTarget) {
        super();
    }

    write(bytes: Uint8Array): void {
        this.written.push(bytes);
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        queueMicrotask(() => this.emit('close'));
    }
}

const DEVICES_FIELD: ConfigField = {
    key: 'devices',
    label: 'Devices',
    type: 'list',
    columns: [
        { key: 'name', label: 'Name', type: 'string' },
        { key: 'address', label: 'Address', type: 'url' },
    ],
};

function manifest(permissions: Partial<PluginManifest['permissions']> = {}): PluginManifest {
    return {
        id: PLUGIN_ID,
        name: 'TLS Plugin',
        version: '1.0.0',
        capabilities: ['output'],
        apiVersion: '^1.0.0',
        permissions: { network: ['device.example.com', { fromConfig: 'devices' }], storage: false, oauth: false, tls: true, ...permissions },
        configFields: [DEVICES_FIELD],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
    };
}

const resolving: AddressResolver = vi.fn(async () => ['93.184.216.34']);

function setup(options: { grantOpen?: boolean; devices?: string[]; platformTls?: boolean } = {}) {
    const opened: FakeTlsConnection[] = [];
    const openTls = vi.fn<HostTlsOpener>(target => {
        const connection = new FakeTlsConnection(target);
        opened.push(connection);
        return connection;
    });
    const grants = {
        holds: (_id: string, capability: string) => options.grantOpen === true && capability === NETWORK_OPEN,
    } as unknown as PluginGrantsService;
    // A `list` is stored as the JSON text of its rows, which is what the allowlist reads.
    const config = { devices: JSON.stringify((options.devices ?? []).map(address => ({ name: address, address }))) };
    const configService = { getConfig: vi.fn(async () => config) } as unknown as PluginConfigService;
    const pluginLog = stubPluginLog();
    const factory = new PluginHostFactory(
        // The platform's own opener when asked for, which is the round trip below.
        options.platformTls === true
            ? new PluginHostFactoryOptions('https://host.example', resolving)
            : new PluginHostFactoryOptions('https://host.example', resolving, undefined, openTls),
        stubContainer([[PluginConfigService, configService]]).container,
        pluginLog.log,
        stubShimClient(),
        grants,
    );
    return { factory, opened, openTls, logger: pluginLog.scoped };
}

async function refusal(call: Promise<unknown>): Promise<PluginError> {
    const error = await call.then(
        () => undefined,
        (caught: unknown) => caught,
    );
    if (!isPluginError(error)) throw new Error(`expected a PluginError, got ${String(error)}`);
    return error;
}

/** Opens a connection and lets the far end finish the handshake. */
async function openTls(harness: ReturnType<typeof setup>, url = 'tls://device.example.com:8009') {
    const host = harness.factory.createHost(manifest());
    const pending = host.tls(url);
    await vi.waitFor(() => expect(harness.opened.length).toBeGreaterThan(0));
    const raw = harness.opened.at(-1) as FakeTlsConnection;
    raw.emit('secureConnect');
    return { host, socket: await pending, raw };
}

afterEach(() => {
    vi.useRealTimers();
});

describe('PluginHostFactory host.tls', () => {
    it('refuses a plugin that did not declare the permission', async () => {
        const { factory, openTls: opener } = setup();

        const error = await refusal(factory.createHost(manifest({ tls: undefined })).tls('tls://device.example.com:8009'));

        expect(error.code).toBe<PluginErrorCode>('internal');
        expect(opener).not.toHaveBeenCalled();
    });

    it.each(['https://device.example.com:8009', 'wss://device.example.com:8009', 'not a url'])('refuses %s: tls only', async url => {
        const { factory, openTls: opener } = setup();

        const error = await refusal(factory.createHost(manifest()).tls(url));

        expect(error.code).toBe<PluginErrorCode>('config');
        expect(opener).not.toHaveBeenCalled();
    });

    it('refuses a URL with no port, since tls: has no default', async () => {
        const { factory, openTls: opener } = setup();

        const error = await refusal(factory.createHost(manifest()).tls('tls://device.example.com'));

        expect(error.code).toBe<PluginErrorCode>('config');
        expect(opener).not.toHaveBeenCalled();
    });

    it('holds a connection to the same allowlist as fetch', async () => {
        const { factory, openTls: opener } = setup();

        const error = await refusal(factory.createHost(manifest()).tls('tls://elsewhere.example.net:8009'));

        expect(error.code).toBe<PluginErrorCode>('forbidden');
        expect(opener).not.toHaveBeenCalled();
    });

    it('reaches a LAN address the operator put in the plugin settings', async () => {
        const harness = setup({ devices: ['tls://192.168.1.20:8009'] });
        const host = harness.factory.createHost(manifest());

        const pending = host.tls('tls://192.168.1.20:8009', { verifyCertificate: false });
        await vi.waitFor(() => expect(harness.opened).toHaveLength(1));
        harness.opened[0]!.emit('secureConnect');
        await pending;

        expect(harness.opened[0]!.target).toEqual({ host: '192.168.1.20', port: 8009, verifyCertificate: false });
    });

    it('refuses to skip certificate checks for a host the manifest named', async () => {
        const { factory, openTls: opener } = setup();

        const error = await refusal(factory.createHost(manifest()).tls('tls://device.example.com:8009', { verifyCertificate: false }));

        expect(error.code).toBe<PluginErrorCode>('forbidden');
        expect(opener).not.toHaveBeenCalled();
    });

    it('refuses to skip certificate checks for a host reached through network.open', async () => {
        const { factory, openTls: opener } = setup({ grantOpen: true });

        const error = await refusal(factory.createHost(manifest()).tls('tls://anywhere.example.org:8009', { verifyCertificate: false }));

        expect(error.code).toBe<PluginErrorCode>('forbidden');
        expect(opener).not.toHaveBeenCalled();
    });

    it('passes bytes both ways once the handshake is done', async () => {
        const harness = setup();
        const { socket, raw } = await openTls(harness);
        const received: Uint8Array[] = [];
        socket.onData(bytes => received.push(bytes));

        socket.send(new Uint8Array([1, 2, 3]));
        raw.emit('data', new Uint8Array([4, 5]));

        expect(raw.written).toEqual([new Uint8Array([1, 2, 3])]);
        expect(received).toEqual([new Uint8Array([4, 5])]);
        expect(raw.target.verifyCertificate).toBe(true);
    });

    it('rejects when the connection closes before the handshake, naming the error', async () => {
        const harness = setup();
        const pending = harness.factory.createHost(manifest()).tls('tls://device.example.com:8009');
        await vi.waitFor(() => expect(harness.opened).toHaveLength(1));

        harness.opened[0]!.emit('error', new Error('self-signed certificate'));
        harness.opened[0]!.emit('close');
        const error = await refusal(pending);

        expect(error.code).toBe<PluginErrorCode>('upstream');
        expect(error.message).toContain('self-signed certificate');
    });

    it('times out a handshake that never finishes', async () => {
        vi.useFakeTimers();
        const harness = setup();
        const pending = harness.factory.createHost(manifest()).tls('tls://device.example.com:8009', { connectTimeoutMs: 50 });
        const caught = refusal(pending);
        await vi.waitFor(() => expect(harness.opened).toHaveLength(1));

        await vi.advanceTimersByTimeAsync(60);
        const error = await caught;

        expect(error.code).toBe<PluginErrorCode>('timeout');
        expect(harness.opened[0]!.destroyed).toBe(true);
    });

    it('tells close listeners when the device hangs up, and ignores sends after', async () => {
        const harness = setup();
        const { socket, raw } = await openTls(harness);
        const closes: (string | undefined)[] = [];
        socket.onClose(reason => closes.push(reason));

        raw.emit('error', new Error('ECONNRESET'));
        raw.emit('close');
        socket.send(new Uint8Array([9]));

        expect(closes).toEqual(['ECONNRESET']);
        expect(raw.written).toEqual([]);
    });

    it('keeps a listener that throws from reaching the event loop', async () => {
        const harness = setup();
        const { socket, raw } = await openTls(harness);
        socket.onData(() => {
            throw new Error('plugin bug');
        });

        expect(() => raw.emit('data', new Uint8Array([1]))).not.toThrow();
        expect(harness.logger.warn).toHaveBeenCalled();
    });

    it(`caps a plugin at ${PLUGIN_TLS_MAX_OPEN} open connections`, async () => {
        const harness = setup();
        const host = harness.factory.createHost(manifest());
        for (let i = 0; i < PLUGIN_TLS_MAX_OPEN; i++) {
            const pending = host.tls('tls://device.example.com:8009');
            await vi.waitFor(() => expect(harness.opened).toHaveLength(i + 1));
            harness.opened[i]!.emit('secureConnect');
            await pending;
        }

        const error = await refusal(host.tls('tls://device.example.com:8009'));

        expect(error.code).toBe<PluginErrorCode>('internal');
    });

    it('closes every connection on dispose without telling the plugin, and refuses another', async () => {
        const harness = setup();
        const { host, socket, raw } = await openTls(harness);
        const closes: unknown[] = [];
        socket.onClose(reason => closes.push(reason));

        harness.factory.closeOpenSockets(PLUGIN_ID);
        await Promise.resolve();

        expect(raw.destroyed).toBe(true);
        expect(closes).toEqual([]);
        expect((await refusal(host.tls('tls://device.example.com:8009'))).code).toBe<PluginErrorCode>('unavailable');
    });

    describe('against a real TLS server', () => {
        let dir = '';
        let key: Buffer;
        let cert: Buffer;
        let server: Server | undefined;

        beforeAll(() => {
            dir = mkdtempSync(join(tmpdir(), 'deadair-tls-'));
            // A device's certificate as a Chromecast's looks from here: valid, and signed by nobody.
            execFileSync(
                'openssl',
                [
                    'req',
                    '-x509',
                    '-newkey',
                    'ec',
                    '-pkeyopt',
                    'ec_paramgen_curve:prime256v1',
                    '-nodes',
                    '-days',
                    '1',
                    '-subj',
                    '/CN=deadair-test-device',
                    '-addext',
                    'subjectAltName=IP:127.0.0.1',
                    '-keyout',
                    join(dir, 'key.pem'),
                    '-out',
                    join(dir, 'cert.pem'),
                ],
                { stdio: 'ignore' },
            );
            key = readFileSync(join(dir, 'key.pem'));
            cert = readFileSync(join(dir, 'cert.pem'));
        });

        afterAll(() => rmSync(dir, { recursive: true, force: true }));

        afterEach(async () => {
            await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
            server = undefined;
        });

        /** An echo server on a free loopback port, answering with what it was sent reversed. */
        async function echoServer(): Promise<number> {
            server = createServer({ key, cert }, connection => {
                connection.on('data', (bytes: Buffer) => connection.write(Buffer.from(bytes).reverse()));
            });
            await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
            const address = server.address();
            if (address === null || typeof address === 'string') throw new Error('no port');
            return address.port;
        }

        it('round-trips bytes to a device with an unsigned certificate it was told about', async () => {
            const port = await echoServer();
            const { factory } = setup({ devices: [`tls://127.0.0.1:${port}`], platformTls: true });
            const socket = await factory.createHost(manifest()).tls(`tls://127.0.0.1:${port}`, { verifyCertificate: false });
            const answer = new Promise<Uint8Array>(resolve => socket.onData(resolve));

            socket.send(new Uint8Array([1, 2, 3]));

            expect([...(await answer)]).toEqual([3, 2, 1]);
            socket.close();
        });

        it('refuses the same device when the certificate is checked', async () => {
            const port = await echoServer();
            const { factory } = setup({ devices: [`tls://127.0.0.1:${port}`], platformTls: true });

            const error = await refusal(factory.createHost(manifest()).tls(`tls://127.0.0.1:${port}`));

            expect(error.code).toBe<PluginErrorCode>('upstream');
        });
    });
});
