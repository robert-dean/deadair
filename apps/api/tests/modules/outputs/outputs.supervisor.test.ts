import { describe, expect, it } from 'vitest';
import { PluginError } from '@deadair/plugin-sdk';

import { OutputsSupervisor, REPLAY_BACKOFF_MS } from '../../../src/modules/outputs/outputs.supervisor.js';
import { PLUGIN_ID, PUBLIC_URL, kitchen, outputsWorld, stubLogger } from './outputs.harness.js';

const OURS = `${PUBLIC_URL}/live.mp3`;

async function supervising() {
    const world = outputsWorld();
    await world.casts.save({ pluginId: PLUGIN_ID, deviceId: kitchen.id, deviceName: 'Kitchen', mountPath: '/live.mp3' });
    const supervisor = new OutputsSupervisor(world.container, world.speakers, stubLogger());
    return { ...world, supervisor };
}

describe('OutputsSupervisor', () => {
    it.each(['opening', 'buffering', 'playing'] as const)('leaves a speaker that is %s alone', async phase => {
        const { supervisor, plugin, casts } = await supervising();
        plugin.answers(kitchen.id, { phase, url: OURS });

        await supervisor.check();

        expect(plugin.instance.play).not.toHaveBeenCalled();
        expect(casts.rows).toHaveLength(1);
    });

    it('waits out a speaker that does not answer, sending it nothing but the next question', async () => {
        const { supervisor, plugin, casts } = await supervising();
        plugin.answers(kitchen.id, { phase: 'unreachable' });

        await supervisor.check();

        expect(plugin.instance.play).not.toHaveBeenCalled();
        expect(casts.rows).toHaveLength(1);
    });

    it('plays the station again on a speaker that dropped its stream, then backs off', async () => {
        const { supervisor, plugin } = await supervising();
        plugin.answers(kitchen.id, { phase: 'stopped', url: OURS, detail: 'the device could not play the stream' });

        await supervisor.check(1_000);
        await supervisor.check(1_000 + REPLAY_BACKOFF_MS[1] - 1);
        expect(plugin.instance.play).toHaveBeenCalledTimes(1);
        expect(plugin.instance.play).toHaveBeenCalledWith(expect.objectContaining({ deviceId: kitchen.id, url: OURS }));

        await supervisor.check(1_000 + REPLAY_BACKOFF_MS[1]);
        expect(plugin.instance.play).toHaveBeenCalledTimes(2);
    });

    it('starts the backoff over once the speaker is playing again', async () => {
        const { supervisor, plugin } = await supervising();
        plugin.answers(kitchen.id, { phase: 'stopped', url: OURS });
        await supervisor.check(0);
        plugin.answers(kitchen.id, { phase: 'playing', url: OURS });
        await supervisor.check(1);

        plugin.answers(kitchen.id, { phase: 'stopped', url: OURS });
        await supervisor.check(2);

        expect(plugin.instance.play).toHaveBeenCalledTimes(2);
    });

    it('forgets a cast when somebody puts something else on the speaker, and never plays over it', async () => {
        const { supervisor, plugin, casts } = await supervising();
        plugin.answers(kitchen.id, { phase: 'stopped', detail: 'now showing Netflix' });

        await supervisor.check();

        expect(plugin.instance.play).not.toHaveBeenCalled();
        expect(casts.rows).toEqual([]);
    });

    it('puts an idle speaker back on the station at its first look after a restart', async () => {
        const { supervisor, plugin, casts } = await supervising();
        plugin.answers(kitchen.id, { phase: 'idle' });

        await supervisor.check();

        expect(plugin.instance.play).toHaveBeenCalledTimes(1);
        expect(casts.rows).toHaveLength(1);
    });

    it('forgets a cast that goes idle later, which is somebody stopping it on the speaker', async () => {
        const { supervisor, plugin, casts } = await supervising();
        plugin.answers(kitchen.id, { phase: 'playing', url: OURS });
        await supervisor.check();

        plugin.answers(kitchen.id, { phase: 'idle' });
        await supervisor.check();

        expect(plugin.instance.play).not.toHaveBeenCalled();
        expect(casts.rows).toEqual([]);
    });

    it('forgets a cast whose speaker the plugin no longer has', async () => {
        const { supervisor, plugin, casts } = await supervising();
        plugin.instance.status.mockRejectedValue(new PluginError('no speaker').withCode('config'));

        await supervisor.check();

        expect(casts.rows).toEqual([]);
    });

    it('keeps a cast whose plugin is not running, for whoever fixes the plugin', async () => {
        const { supervisor, registry, casts } = await supervising();
        registry.setAll([]);

        await supervisor.check();

        expect(casts.rows).toHaveLength(1);
    });

    it('folds a check asked for while one is running into that one', async () => {
        const { supervisor, plugin } = await supervising();
        plugin.answers(kitchen.id, { phase: 'playing', url: OURS });

        await Promise.all([supervisor.check(), supervisor.check()]);

        expect(plugin.instance.status).toHaveBeenCalledTimes(1);
    });

    it('stops its loop and waits for a check in flight', async () => {
        const { supervisor } = await supervising();
        supervisor.start();

        await expect(supervisor.stop()).resolves.toBeUndefined();
    });
});
