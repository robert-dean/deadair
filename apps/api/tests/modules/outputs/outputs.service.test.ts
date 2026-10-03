import { describe, expect, it } from 'vitest';
import { PluginError } from '@deadair/plugin-sdk';
import type { AuthorizationContext } from '../../../src/modules/permissions/authorization.context.js';

import { OutputsService } from '../../../src/modules/outputs/outputs.service.js';
import type { PluginHostFactory } from '../../../src/modules/plugins/plugin.host.factory.js';
import { PLUGIN_ID, PUBLIC_URL, kitchen, outputsWorld, speakerPlugin } from './outputs.harness.js';

const operator = { actor: { kind: 'user', actorId: '00000000-0000-0000-0000-000000000001' } } as unknown as AuthorizationContext;

function service(options: Parameters<typeof outputsWorld>[0] = {}) {
    const world = outputsWorld(options);
    const hosts = { discoverySeesNothing: () => false } as unknown as PluginHostFactory;
    return { ...world, service: new OutputsService(operator, world.repository, world.speakers, world.settings.config, hosts) };
}

async function status(call: Promise<unknown>): Promise<number | undefined> {
    const error = await call.then(
        () => undefined,
        (caught: unknown) => caught as { statusCode?: number },
    );
    return error?.statusCode;
}

describe('OutputsService.listDevices', () => {
    it("lists every speaker with the station's mounts it can play, and whether it is casting", async () => {
        const { service: outputs, casts } = service({ settings: { 'stream.aacEnabled': 'true', 'stream.opusEnabled': 'true' } });
        await casts.save({ pluginId: PLUGIN_ID, deviceId: kitchen.id, deviceName: 'Kitchen', mountPath: '/live.mp3' });

        await expect(outputs.listDevices()).resolves.toEqual({
            devices: [
                {
                    pluginId: PLUGIN_ID,
                    deviceId: kitchen.id,
                    name: 'Kitchen',
                    address: '10.0.0.5',
                    protocol: 'chromecast',
                    mounts: [
                        { format: 'mp3', path: '/live.mp3' },
                        { format: 'aac', path: '/live.aac' },
                    ],
                    casting: true,
                },
            ],
            problems: [],
            discoverySeesNothing: false,
        });
    });

    it('reports a plugin that cannot list its speakers, and still lists the others', async () => {
        const failing = speakerPlugin();
        failing.instance.listDevices.mockRejectedValue(new PluginError('discovery broke').withCode('upstream'));
        const working = speakerPlugin([{ ...kitchen, id: 'chromecast:10.0.0.6', name: 'Den' }]);
        const records = [
            { ...failing.record, id: 'deadair.broken', manifest: { ...failing.record.manifest!, id: 'deadair.broken' } },
            working.record,
        ];

        const answer = await service({ records }).service.listDevices();

        expect(answer.devices.map(device => device.name)).toEqual(['Den']);
        expect(answer.problems).toEqual([{ pluginId: 'deadair.broken', message: expect.stringContaining('discovery broke') }]);
    });
});

describe('OutputsService.startCast', () => {
    it('plays the MP3 mount on the public address, then remembers the cast', async () => {
        const { service: outputs, plugin, casts } = service();

        const cast = await outputs.startCast({ pluginId: PLUGIN_ID, deviceId: kitchen.id });

        expect(plugin.instance.play).toHaveBeenCalledWith({
            deviceId: kitchen.id,
            url: `${PUBLIC_URL}/live.mp3`,
            contentType: 'audio/mpeg',
            metadata: { title: 'deadair', subtitle: 'The late show', artworkUrl: `${PUBLIC_URL}/logo.png` },
        });
        expect(cast).toMatchObject({ pluginId: PLUGIN_ID, deviceId: kitchen.id, deviceName: 'Kitchen', mountPath: '/live.mp3', phase: 'opening' });
        expect(casts.rows).toHaveLength(1);
    });

    it('plays the mount asked for when the speaker takes it', async () => {
        const { service: outputs, plugin } = service({ settings: { 'stream.aacEnabled': 'true' } });

        await outputs.startCast({ pluginId: PLUGIN_ID, deviceId: kitchen.id, mountPath: '/live.aac' });

        expect(plugin.instance.play).toHaveBeenCalledWith(expect.objectContaining({ url: `${PUBLIC_URL}/live.aac`, contentType: 'audio/aac' }));
    });

    it('refuses a mount the speaker cannot play with a 400, and plays nothing', async () => {
        const { service: outputs, plugin } = service({ settings: { 'stream.flacEnabled': 'true' } });

        expect(await status(outputs.startCast({ pluginId: PLUGIN_ID, deviceId: kitchen.id, mountPath: '/live.flac' }))).toBe(400);
        expect(plugin.instance.play).not.toHaveBeenCalled();
    });

    it('refuses with a 400 when the station has no address a speaker could reach', async () => {
        const { service: outputs, casts } = service({ settings: { 'stream.publicUrl': 'http://localhost:8080' } });

        expect(await status(outputs.startCast({ pluginId: PLUGIN_ID, deviceId: kitchen.id }))).toBe(400);
        expect(casts.rows).toEqual([]);
    });

    it('answers 404 for a plugin or a speaker that is not there', async () => {
        const { service: outputs } = service();

        expect(await status(outputs.startCast({ pluginId: 'deadair.nope', deviceId: kitchen.id }))).toBe(404);
        expect(await status(outputs.startCast({ pluginId: PLUGIN_ID, deviceId: 'chromecast:10.9.9.9' }))).toBe(404);
    });

    it('remembers nothing when the speaker refuses, so nothing keeps retrying it', async () => {
        const { service: outputs, plugin, casts } = service();
        plugin.instance.play.mockRejectedValue(new PluginError('LOAD_FAILED').withCode('upstream'));

        expect(await status(outputs.startCast({ pluginId: PLUGIN_ID, deviceId: kitchen.id }))).toBe(502);
        expect(casts.rows).toEqual([]);
    });
});

describe('OutputsService.listCasts', () => {
    it('asks each speaker how it is, and reports one whose plugin is gone as unreachable', async () => {
        const { service: outputs, plugin, casts } = service();
        plugin.answers(kitchen.id, { phase: 'playing', url: `${PUBLIC_URL}/live.mp3` });
        await casts.save({ pluginId: PLUGIN_ID, deviceId: kitchen.id, deviceName: 'Kitchen', mountPath: '/live.mp3' });
        await casts.save({ pluginId: 'deadair.gone', deviceId: 'x', deviceName: 'Attic', mountPath: '/live.mp3' });

        const { casts: listed } = await outputs.listCasts();

        expect(listed.map(cast => [cast.deviceName, cast.phase])).toEqual([
            ['Kitchen', 'playing'],
            ['Attic', 'unreachable'],
        ]);
        expect(listed[1]!.detail).toContain('deadair.gone');
    });

    it('reports a speaker whose status call fails as unreachable rather than failing the list', async () => {
        const { service: outputs, plugin, casts } = service();
        plugin.instance.status.mockRejectedValue(new PluginError('no answer').withCode('timeout'));
        await casts.save({ pluginId: PLUGIN_ID, deviceId: kitchen.id, deviceName: 'Kitchen', mountPath: '/live.mp3' });

        await expect(outputs.listCasts()).resolves.toMatchObject({ casts: [{ phase: 'unreachable', detail: expect.stringContaining('no answer') }] });
    });
});

describe('OutputsService.stopCast', () => {
    it('forgets the cast before stopping the speaker, so the supervisor cannot put it back', async () => {
        const { service: outputs, plugin, casts } = service();
        await casts.save({ pluginId: PLUGIN_ID, deviceId: kitchen.id, deviceName: 'Kitchen', mountPath: '/live.mp3' });
        plugin.instance.stop.mockImplementation(async () => {
            expect(casts.rows).toEqual([]);
        });

        await outputs.stopCast(PLUGIN_ID, kitchen.id);

        expect(plugin.instance.stop).toHaveBeenCalledWith(kitchen.id);
    });

    it('answers quietly for a speaker the plugin no longer has', async () => {
        const { service: outputs, plugin } = service();
        plugin.instance.stop.mockRejectedValue(new PluginError('no speaker').withCode('config'));

        await expect(outputs.stopCast(PLUGIN_ID, kitchen.id)).resolves.toBeUndefined();
    });

    it('reports a speaker that would not stop, so the operator knows it may still be playing', async () => {
        const { service: outputs, plugin } = service();
        plugin.instance.stop.mockRejectedValue(new PluginError('no answer').withCode('timeout'));

        expect(await status(outputs.stopCast(PLUGIN_ID, kitchen.id))).toBe(504);
    });

    it('stops nothing for a plugin that is not running, and still forgets the cast', async () => {
        const { service: outputs, casts } = service();
        await casts.save({ pluginId: 'deadair.gone', deviceId: 'x', deviceName: 'Attic', mountPath: '/live.mp3' });

        await outputs.stopCast('deadair.gone', 'x');

        expect(casts.rows).toEqual([]);
    });
});
