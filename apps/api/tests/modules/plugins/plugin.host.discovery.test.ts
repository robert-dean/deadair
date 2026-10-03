import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    isPluginError,
    type DiscoveredService,
    type DiscoveryQuery,
    type PluginError,
    type PluginErrorCode,
    type PluginManifest,
} from '@deadair/plugin-sdk';

import { DISCOVERY_MAX_TIMEOUT_MS, readSsdpHeaders, readTxt, type NetworkDiscoverer } from '../../../src/modules/plugins/plugin.discovery.js';
import { PluginHostFactory, PluginHostFactoryOptions, type HostTlsOpener } from '../../../src/modules/plugins/plugin.host.factory.js';
import type { AddressResolver } from '../../../src/modules/plugins/plugin.grants.js';
import type { PluginGrantsService } from '../../../src/modules/plugins/plugin.grants.service.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';
import { stubShimClient } from '../../utils/spotify.shim.fixture.js';
import { stubContainer } from '../../utils/stub.container.js';

/**
 * `host.discover`: the host's one discoverer, run for a query the manifest named, and the addresses
 * that answered admitted to that plugin's allowlist the way an address the operator typed in is.
 */
const CAST: DiscoveryQuery = { protocol: 'mdns', service: '_googlecast._tcp' };

const kitchen: DiscoveredService = { name: 'Kitchen', address: '192.168.1.148', port: 8009, txt: { fn: 'Kitchen speaker' } };

function manifest(discovery: DiscoveryQuery[] = [CAST]): PluginManifest {
    return {
        id: 'test.discovery',
        name: 'Discovery Plugin',
        version: '1.0.0',
        capabilities: ['output'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false, tls: true, discovery },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
    };
}

function setup(found: DiscoveredService[] = [kitchen]) {
    const discoverer = { discover: vi.fn(async () => found), seesNothing: vi.fn(() => found.length === 0) } satisfies NetworkDiscoverer;
    const openTls = vi.fn<HostTlsOpener>(() => {
        throw new Error('not opened in these tests');
    });
    const resolving: AddressResolver = vi.fn(async () => ['93.184.216.34']);
    const factory = new PluginHostFactory(
        new PluginHostFactoryOptions('https://host.example', resolving, undefined, openTls, discoverer),
        stubContainer([]).container,
        stubPluginLog().log,
        stubShimClient(),
        { holds: () => false } as unknown as PluginGrantsService,
    );
    return { factory, discoverer, openTls };
}

async function refusal(call: Promise<unknown>): Promise<PluginError> {
    const error = await call.then(
        () => undefined,
        (caught: unknown) => caught,
    );
    if (!isPluginError(error)) throw new Error(`expected a PluginError, got ${String(error)}`);
    return error;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('PluginHostFactory host.discover', () => {
    it('answers what the discoverer found, for a query the manifest named', async () => {
        const { factory, discoverer } = setup();

        await expect(factory.createHost(manifest()).discover(CAST)).resolves.toEqual([kitchen]);
        expect(discoverer.discover).toHaveBeenCalledWith(CAST, expect.any(Number));
    });

    it('refuses a query the manifest did not name', async () => {
        const { factory, discoverer } = setup();

        const error = await refusal(factory.createHost(manifest()).discover({ protocol: 'ssdp', searchTarget: 'ssdp:all' }));

        expect(error.code).toBe<PluginErrorCode>('internal');
        expect(discoverer.discover).not.toHaveBeenCalled();
    });

    it('refuses a plugin that declared no discovery at all', async () => {
        const { factory } = setup();
        const bare = manifest();
        delete bare.permissions.discovery;

        expect((await refusal(factory.createHost(bare).discover(CAST))).code).toBe<PluginErrorCode>('internal');
    });

    it('clamps how long it listens to the host’s ceiling', async () => {
        const { factory, discoverer } = setup();

        await factory.createHost(manifest()).discover(CAST, { timeoutMs: 60_000 });

        expect(discoverer.discover).toHaveBeenCalledWith(CAST, DISCOVERY_MAX_TIMEOUT_MS);
    });

    it('lets the plugin reach an address only once discovery has found it there', async () => {
        const { factory } = setup();
        const fetchMock = vi.fn(async () => new Response('ok'));
        vi.stubGlobal('fetch', fetchMock);
        const host = factory.createHost(manifest());

        expect((await refusal(host.fetch('http://192.168.1.148:8008/setup/eureka_info'))).code).toBe<PluginErrorCode>('forbidden');

        await host.discover(CAST);
        await expect(host.fetch('http://192.168.1.148:8008/setup/eureka_info')).resolves.toBeInstanceOf(Response);
    });

    it('admits the host an SSDP answer’s description is on, as well as the address it answered from', async () => {
        const { factory } = setup([{ name: 'uuid:renderer', address: '192.168.1.176', location: 'http://renderer.lan:44667/description.xml' }]);
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('<root/>')),
        );
        const host = factory.createHost(manifest([{ protocol: 'ssdp', searchTarget: 'urn:schemas-upnp-org:device:MediaRenderer:1' }]));

        await host.discover({ protocol: 'ssdp', searchTarget: 'urn:schemas-upnp-org:device:MediaRenderer:1' });

        await expect(host.fetch('http://renderer.lan:44667/description.xml')).resolves.toBeInstanceOf(Response);
    });

    it('treats a discovered device like one the operator typed in, so its unsigned certificate may be accepted', async () => {
        const { factory, openTls } = setup();
        const host = factory.createHost(manifest());
        await host.discover(CAST);

        // Past the policy, and so on to the opener, which this test's double refuses.
        const error = await refusal(host.tls('tls://192.168.1.148:8009', { verifyCertificate: false }));

        expect(error.code).toBe<PluginErrorCode>('upstream');
        expect(openTls).toHaveBeenCalledWith({ host: '192.168.1.148', port: 8009, verifyCertificate: false });
    });

    it('starts a new instance of the plugin from nothing found, rather than everything an earlier one saw', async () => {
        const { factory } = setup();
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('ok')),
        );
        await factory.createHost(manifest()).discover(CAST);

        const fresh = factory.createHost(manifest());

        expect((await refusal(fresh.fetch('http://192.168.1.148:8008/'))).code).toBe<PluginErrorCode>('forbidden');
    });

    it('says when discovery has never found anything, for the console to say once', () => {
        expect(setup([]).factory.discoverySeesNothing()).toBe(true);
        expect(setup().factory.discoverySeesNothing()).toBe(false);
    });
});

describe('the discovery parsers', () => {
    it('reads an SSDP answer’s headers by lower-cased name', () => {
        const answer = [
            'HTTP/1.1 200 OK',
            'CACHE-CONTROL: max-age=1800',
            'LOCATION: http://192.168.1.56:9197/dmr',
            'SERVER: Samsung-Linux/4.1, UPnP/1.0, Samsung_UPnP_SDK/1.0',
            'ST: urn:schemas-upnp-org:device:MediaRenderer:1',
            'USN: uuid:renderer::urn:schemas-upnp-org:device:MediaRenderer:1',
            '',
            '',
        ].join('\r\n');

        expect(readSsdpHeaders(answer)).toMatchObject({
            location: 'http://192.168.1.56:9197/dmr',
            st: 'urn:schemas-upnp-org:device:MediaRenderer:1',
            usn: 'uuid:renderer::urn:schemas-upnp-org:device:MediaRenderer:1',
        });
    });

    it('reads a TXT record’s key=value strings, keeping an equals sign inside a value', () => {
        expect(readTxt([Buffer.from('fn=Kitchen speaker'), Buffer.from('md=Google Home Mini'), Buffer.from('rs=a=b')])).toEqual({
            fn: 'Kitchen speaker',
            md: 'Google Home Mini',
            rs: 'a=b',
        });
    });
});
