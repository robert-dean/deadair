import { describe, expect, it, vi } from 'vitest';
import type { PluginManifest } from '@deadair/plugin-sdk';
import type { Logger } from '@maroonedsoftware/logger';

import { PluginAirState } from '../../../src/modules/plugins/plugin.air.state.js';
import { PluginHostFactory, PluginHostFactoryOptions } from '../../../src/modules/plugins/plugin.host.factory.js';
import type { PluginGrantsService } from '../../../src/modules/plugins/plugin.grants.service.js';
import { StationBus } from '../../../src/modules/shared/station.bus.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';
import { stubApplePlayerClient, stubShimClient } from '../../utils/spotify.shim.fixture.js';
import { stubContainer } from '../../utils/stub.container.js';

/**
 * `host.air`: whether the station is on air, as the pusher says it on the station bus, handed to
 * every plugin through its host. Through the real factory, because the per-plugin bookkeeping (a
 * listener dropped on dispose) is the part a unit test of the state alone would not see.
 */
const PLUGIN_ID = 'test.air';

function manifest(id = PLUGIN_ID): PluginManifest {
    return {
        id,
        name: 'Air Plugin',
        version: '1.0.0',
        capabilities: ['speech'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
    };
}

function setup() {
    const air = new PluginAirState();
    const bus = new StationBus({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger);
    air.follow(bus);
    const pluginLog = stubPluginLog();
    const factory = new PluginHostFactory(
        new PluginHostFactoryOptions('https://host.example'),
        stubContainer([]).container,
        pluginLog.log,
        stubShimClient(),
        stubApplePlayerClient(),
        { holds: () => false } as unknown as PluginGrantsService,
        air,
    );
    const say = (on: boolean) => bus.publish('air.wanted', { on, at: Date.now() });
    return { factory, say, logger: pluginLog.scoped };
}

/** Lets the microtasks each listener is delivered on run. */
const delivered = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('host.air', () => {
    it('reads off until the station says otherwise, then follows what it says', () => {
        const { factory, say } = setup();
        const host = factory.createHost(manifest());

        expect(host.air.isOn()).toBe(false);
        say(true);
        expect(host.air.isOn()).toBe(true);
        say(false);
        expect(host.air.isOn()).toBe(false);
    });

    it('tells a listener each change once, with the new state', async () => {
        const { factory, say } = setup();
        const heard: boolean[] = [];
        factory.createHost(manifest()).air.onChange(on => {
            heard.push(on);
        });

        say(true);
        say(true);
        say(false);
        await delivered();

        expect(heard).toEqual([true, false]);
    });

    it('tells a listener after the change, never inside the publish that made it', async () => {
        // The publisher is the pusher's reconcile pass. Nothing a plugin does on hearing the news
        // may run in that frame, or a slow listener would hold up the loop that keeps the station on.
        const { factory, say } = setup();
        const listener = vi.fn();
        factory.createHost(manifest()).air.onChange(listener);

        say(true);
        expect(listener).not.toHaveBeenCalled();

        await delivered();
        expect(listener).toHaveBeenCalledWith(true);
    });

    it('stops telling a listener once it unsubscribes', async () => {
        const { factory, say } = setup();
        const listener = vi.fn();
        const unsubscribe = factory.createHost(manifest()).air.onChange(listener);

        unsubscribe();
        say(true);
        await delivered();

        expect(listener).not.toHaveBeenCalled();
    });

    it('logs a listener that throws or rejects, and still tells the others', async () => {
        const { factory, say, logger } = setup();
        const host = factory.createHost(manifest());
        const after = vi.fn();
        host.air.onChange(() => {
            throw new Error('sync');
        });
        host.air.onChange(async () => {
            throw new Error('async');
        });
        host.air.onChange(after);

        say(true);
        await delivered();

        expect(after).toHaveBeenCalledWith(true);
        expect(logger.warn).toHaveBeenCalledTimes(2);
        expect(logger.warn.mock.calls[0]?.[0]).toContain('going on air');
    });

    it('drops every listener a plugin forgot once the plugin is released', async () => {
        const { factory, say } = setup();
        const forgotten = vi.fn();
        const other = vi.fn();
        factory.createHost(manifest()).air.onChange(forgotten);
        factory.createHost(manifest('test.other')).air.onChange(other);

        factory.releaseAirListeners(PLUGIN_ID);
        say(true);
        await delivered();

        expect(forgotten).not.toHaveBeenCalled();
        expect(other).toHaveBeenCalledWith(true);
    });

    it('does not tell a plugin released between the change and the delivery', async () => {
        const { factory, say } = setup();
        const listener = vi.fn();
        factory.createHost(manifest()).air.onChange(listener);

        say(true);
        factory.releaseAirListeners(PLUGIN_ID);
        await delivered();

        expect(listener).not.toHaveBeenCalled();
    });

    it('releases safely for a plugin that never listened, and twice', () => {
        const { factory } = setup();

        expect(() => factory.releaseAirListeners('never.existed')).not.toThrow();
        expect(() => factory.releaseAirListeners('never.existed')).not.toThrow();
    });

    it('stops following the bus once told to', () => {
        const air = new PluginAirState();
        const bus = new StationBus({ warn: vi.fn() } as unknown as Logger);
        const stop = air.follow(bus);

        stop();
        bus.publish('air.wanted', { on: true, at: Date.now() });

        expect(air.isOn()).toBe(false);
    });

    it('reads off forever on a factory built without a state, which only a test does', () => {
        const pluginLog = stubPluginLog();
        const factory = new PluginHostFactory(
            new PluginHostFactoryOptions('https://host.example'),
            stubContainer([]).container,
            pluginLog.log,
            stubShimClient(),
            stubApplePlayerClient(),
            { holds: () => false } as unknown as PluginGrantsService,
        );

        expect(factory.createHost(manifest()).air.isOn()).toBe(false);
    });
});
