import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import type { PluginInstance, PluginManifest } from '@deadair/plugin-sdk';

import { PluginLifecycleManager } from '../../../src/modules/plugins/plugin.lifecycle.manager.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginConfigRecord, PluginConfigRepository } from '../../../src/modules/plugins/plugin.config.repository.js';
import type { PluginConfigService } from '../../../src/modules/plugins/plugin.config.service.js';
import type { PluginHostFactory } from '../../../src/modules/plugins/plugin.host.factory.js';
import type { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import type { PluginLoader } from '../../../src/modules/plugins/plugin.loader.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
    return {
        id: 'spotify',
        name: 'Spotify',
        version: '1.0.0',
        kind: 'music-provider',
        capabilities: ['catalog', 'playout'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
        ...overrides,
    };
}

function config(overrides: Partial<PluginConfigRecord> = {}): PluginConfigRecord {
    return {
        pluginId: 'spotify',
        enabled: true,
        config: {},
        secrets: {},
        createdAt: DateTime.now(),
        updatedAt: DateTime.now(),
        ...overrides,
    };
}

/**
 * A lifecycle manager wired to a real registry and stubs for everything else.
 * `rescan` only touches the loader and the config repository, so the remaining
 * collaborators are inert; the invoker is real enough to pass a `dispose`
 * through, which the disappearance path needs.
 */
function makeManager(registry: PluginRegistry, discovered: PluginRecord[], configs: PluginConfigRecord[]) {
    const pluginLoader = { discover: vi.fn().mockResolvedValue(discovered) } as unknown as PluginLoader;
    const pluginConfigRepository = { list: vi.fn().mockResolvedValue(configs) } as unknown as PluginConfigRepository;
    const pluginInvoker = {
        invoke: vi.fn(async (_id: string, _operation: string, work: () => Promise<unknown>) => work()),
        reset: vi.fn(),
    } as unknown as PluginInvoker;

    const manager = new PluginLifecycleManager(
        pluginLoader,
        registry,
        {} as PluginHostFactory,
        pluginInvoker,
        {} as PluginConfigService,
        pluginConfigRepository,
        stubPluginLog().log,
    );

    return { manager, pluginLoader };
}

describe('PluginLifecycleManager.rescan', () => {
    it('keeps a running plugin when discovery quarantines a duplicate copy of its id', async () => {
        const registry = new PluginRegistry();
        const dispose = vi.fn();
        const instance = { init: async () => {}, dispose } as unknown as PluginInstance;
        const running: PluginRecord = {
            id: 'spotify',
            manifest: manifest(),
            dir: '/app/plugins/spotify',
            status: 'active',
            instance,
        };
        registry.setAll([running]);

        // What the loader returns once an operator symlinks a second copy of the
        // plugin into the mounted plugins directory: the copy that won the id,
        // plus a quarantined duplicate claiming the same id from another dir.
        const { manager } = makeManager(
            registry,
            [
                { id: 'spotify', manifest: manifest(), dir: '/app/plugins/spotify', status: 'discovered' },
                {
                    id: 'spotify',
                    dir: '/srv/plugins/spotify-dev',
                    status: 'failed',
                    error: 'duplicate plugin id "spotify"; the copy loaded first wins',
                },
            ],
            [config()],
        );

        await manager.rescan();

        const after = registry.get('spotify');
        expect(after).toBe(running);
        expect(after?.status).toBe('active');
        expect(after?.dir).toBe('/app/plugins/spotify');
        expect(after?.error).toBeUndefined();
        // The instance is still reachable, so dispose is still callable and the
        // provider has not vanished from the playout path.
        expect(registry.instance('spotify')).toBe(instance);
        expect(dispose).not.toHaveBeenCalled();
        expect(registry.list()).toHaveLength(1);
    });

    it('still registers a quarantined plugin that is not a duplicate of a known id', async () => {
        const registry = new PluginRegistry();
        const { manager } = makeManager(
            registry,
            [{ id: 'broken', dir: '/srv/plugins/broken', status: 'failed', error: 'entry "dist/index.js" does not exist' }],
            [],
        );

        await manager.rescan();

        expect(registry.get('broken')).toEqual(expect.objectContaining({ status: 'failed', dir: '/srv/plugins/broken' }));
    });

    it('disposes and drops a plugin whose directory has disappeared', async () => {
        const registry = new PluginRegistry();
        const dispose = vi.fn();
        registry.setAll([
            {
                id: 'spotify',
                manifest: manifest(),
                dir: '/app/plugins/spotify',
                status: 'active',
                instance: { init: async () => {}, dispose } as unknown as PluginInstance,
            },
        ]);

        const { manager } = makeManager(registry, [], []);

        await manager.rescan();

        expect(dispose).toHaveBeenCalledOnce();
        expect(registry.get('spotify')).toBeUndefined();
    });
});
