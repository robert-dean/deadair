import { describe, expect, it, vi } from 'vitest';
import { isPluginError, type DiscoveredService, type PluginManifest } from '@deadair/plugin-sdk';
import { createFakePluginHost } from '@deadair/plugin-sdk/testing';

import { castManifest } from '../src/cast.manifest.js';
import { CastPlugin, readSpeakers } from '../src/cast.plugin.js';
import type { SpeakerDriver } from '../src/drivers/speaker.driver.js';
import plugin, { manifest } from '../src/index.js';

/** A driver that records what it was asked and answers whatever the test set. */
function stubDriver(protocol: string) {
    return {
        protocol,
        label: protocol,
        describe: vi.fn(async () => ({ accepts: ['audio/mpeg'], followsMetadata: false })),
        play: vi.fn(async () => {}),
        updateMetadata: vi.fn(async () => {}),
        stop: vi.fn(async () => {}),
        status: vi.fn<SpeakerDriver['status']>(async () => ({ phase: 'idle' })),
        dispose: vi.fn(),
    } satisfies SpeakerDriver;
}

const rows = (...list: Record<string, string>[]) => JSON.stringify(list);

async function loaded(devices: string, drivers: SpeakerDriver[] = [stubDriver('chromecast')]) {
    const host = createFakePluginHost();
    host.seedConfig({ devices });
    const instance = new CastPlugin(drivers);
    await instance.init(host);
    return { host, instance, drivers };
}

describe('the cast manifest', () => {
    it('reaches only the addresses in its settings, over TLS', () => {
        expect(manifest.permissions).toMatchObject({ network: [{ fromConfig: 'devices' }], tls: true });
        expect(manifest.capabilities).toEqual(['output']);
    });

    it('offers exactly the protocols it has drivers for', () => {
        const devices = manifest.configFields.find(field => field.key === 'devices');
        const protocol = devices?.columns?.find(column => column.key === 'protocol');

        expect(protocol?.options?.map(option => option.value)).toEqual(['chromecast', 'upnp', 'bluos']);
    });

    it('declares its address column as a url, which is what puts it on the allowlist', () => {
        const columns = castManifest([]).configFields.find(field => field.key === 'devices')?.columns;

        expect(columns?.find(column => column.key === 'address')?.type).toBe('url');
    });

    it('is the default export, with a factory that builds a fresh instance', () => {
        expect((plugin.manifest as PluginManifest).id).toBe('deadair.cast');
        expect(plugin.factory()).not.toBe(plugin.factory());
    });
});

describe('readSpeakers', () => {
    it('keys each row by protocol and address, lowercased, and drops one with no driver', () => {
        const unknown = vi.fn();
        const speakers = readSpeakers(
            rows(
                { name: 'Kitchen', protocol: 'chromecast', address: 'Kitchen.local' },
                { name: 'Den', protocol: 'airplay', address: '10.0.0.9' },
                { name: 'No address', protocol: 'chromecast' },
            ),
            [stubDriver('chromecast')],
            unknown,
        );

        expect([...speakers.keys()]).toEqual(['chromecast:kitchen.local']);
        expect(unknown).toHaveBeenCalledWith('airplay');
    });

    it('treats two rows for one device as one speaker, the later name winning', () => {
        const speakers = readSpeakers(
            rows({ name: 'Old', protocol: 'chromecast', address: '10.0.0.5' }, { name: 'New', protocol: 'chromecast', address: '10.0.0.5' }),
            [stubDriver('chromecast')],
            () => {},
        );

        expect([...speakers.values()].map(speaker => speaker.target.name)).toEqual(['New']);
    });
});

describe('CastPlugin', () => {
    it('lists every configured speaker with what its driver says it plays', async () => {
        const { instance } = await loaded(rows({ name: 'Kitchen', protocol: 'chromecast', address: '10.0.0.5' }));

        await expect(instance.listDevices()).resolves.toEqual([
            {
                id: 'chromecast:10.0.0.5',
                name: 'Kitchen',
                address: '10.0.0.5',
                protocol: 'chromecast',
                accepts: ['audio/mpeg'],
                followsMetadata: false,
            },
        ]);
    });

    it('routes a call to the driver for the device it names, matching the id without case', async () => {
        const chromecast = stubDriver('chromecast');
        const other = stubDriver('other');
        const { instance } = await loaded(
            rows({ name: 'Kitchen', protocol: 'chromecast', address: '10.0.0.5' }, { name: 'Den', protocol: 'other', address: '10.0.0.6' }),
            [chromecast, other],
        );

        await instance.stop('CHROMECAST:10.0.0.5');
        await expect(instance.status('other:10.0.0.6')).resolves.toEqual({ deviceId: 'other:10.0.0.6', phase: 'idle' });

        expect(chromecast.stop).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: 'Kitchen' }));
        expect(other.stop).not.toHaveBeenCalled();
    });

    it('answers an id it does not know with a config error', async () => {
        const { instance } = await loaded(rows());

        const error = await instance.stop('chromecast:10.9.9.9').catch((caught: unknown) => caught);

        expect(isPluginError(error) && error.code).toBe('config');
    });

    it('passes the connection test only when every speaker answers', async () => {
        const drivers = [stubDriver('chromecast')];
        const { instance } = await loaded(
            rows({ name: 'Kitchen', protocol: 'chromecast', address: '10.0.0.5' }, { name: 'Den', protocol: 'chromecast', address: '10.0.0.6' }),
            drivers,
        );
        drivers[0]!.status.mockImplementation(async (_host, target) => (target.name === 'Den' ? { phase: 'unreachable' } : { phase: 'idle' }));

        await expect(instance.testConnection()).resolves.toEqual({ ok: false, message: 'Not answering: Den.' });
    });

    it('says so when there are no speakers to test', async () => {
        const { instance } = await loaded('');

        await expect(instance.testConnection()).resolves.toMatchObject({ ok: false });
    });

    it('disposes every driver when it unloads', async () => {
        const drivers = [stubDriver('chromecast'), stubDriver('other')];
        const { instance } = await loaded(rows(), drivers);

        await instance.dispose();

        for (const driver of drivers) expect(driver.dispose).toHaveBeenCalledOnce();
    });
});

describe('CastPlugin, finding speakers on the network', () => {
    const CAST_QUERY = { protocol: 'mdns', service: '_googlecast._tcp' } as const;

    /** A stub driver that also looks for its devices, reading an answer's TXT `fn` as the name. */
    function lookingDriver(protocol = 'chromecast') {
        return {
            ...stubDriver(protocol),
            discovery: CAST_QUERY,
            found: vi.fn((service: DiscoveredService) => ({
                key: service.txt?.id ?? service.name,
                name: service.txt?.fn ?? service.name,
                address: `${service.address}:8009`,
            })),
        } satisfies SpeakerDriver;
    }

    const kitchen: DiscoveredService = { name: 'Kitchen-123', address: '10.0.0.5', port: 8009, txt: { id: 'abc123', fn: 'Kitchen speaker' } };

    async function looking(devices: string, discover: unknown = undefined) {
        const host = createFakePluginHost();
        host.seedConfig({ devices, ...(discover === undefined ? {} : { discover }) });
        host.seedDiscovery([kitchen]);
        const driver = lookingDriver();
        const instance = new CastPlugin([driver]);
        await instance.init(host);
        return { host, driver, instance };
    }

    it('declares exactly the queries its drivers look with', () => {
        expect(manifest.permissions.discovery).toEqual([
            { protocol: 'mdns', service: '_googlecast._tcp' },
            { protocol: 'ssdp', searchTarget: 'urn:schemas-upnp-org:device:MediaRenderer:1' },
            { protocol: 'mdns', service: '_musc._tcp' },
        ]);
    });

    it('lists a speaker it found, by the id it announced rather than its address', async () => {
        const { instance } = await looking(rows());

        await expect(instance.listDevices()).resolves.toEqual([
            expect.objectContaining({ id: 'chromecast:abc123', name: 'Kitchen speaker', address: '10.0.0.5:8009' }),
        ]);
    });

    it('lets a typed row win over a found speaker at the same address', async () => {
        const { instance } = await looking(rows({ name: 'Mine', protocol: 'chromecast', address: '10.0.0.5' }));

        const devices = await instance.listDevices();

        expect(devices.map(device => device.name)).toEqual(['Mine']);
    });

    it('does not look when the operator switched looking off, whichever way the setting is stored', async () => {
        for (const off of [false, 'false']) {
            const { host, instance } = await looking(rows(), off);
            await instance.listDevices();
            expect(host.discover).not.toHaveBeenCalled();
        }
    });

    it('finds a speaker again for a call that names it, as after a restart', async () => {
        const { driver, instance } = await looking(rows());

        await instance.stop('chromecast:abc123');

        expect(driver.stop).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ address: '10.0.0.5:8009' }));
    });

    it('reports a found speaker that has gone quiet as unreachable, so the host waits for it', async () => {
        const { host, instance } = await looking(rows());
        host.seedDiscovery([]);

        await expect(instance.status('chromecast:gone')).resolves.toEqual({
            deviceId: 'chromecast:gone',
            phase: 'unreachable',
            detail: 'not found on the network',
        });
    });

    it('keeps the finds of one kind when another kind’s looking fails', async () => {
        const host = createFakePluginHost();
        host.seedConfig({ devices: rows() });
        const working = lookingDriver('chromecast');
        const broken = { ...lookingDriver('bluos'), discovery: { protocol: 'mdns', service: '_musc._tcp' } as const };
        vi.mocked(host.discover).mockImplementation(async query => {
            if (query.protocol === 'mdns' && query.service === '_musc._tcp') throw new Error('no socket');
            return [kitchen];
        });
        const instance = new CastPlugin([working, broken]);
        await instance.init(host);

        await expect(instance.listDevices()).resolves.toHaveLength(1);
    });
});
