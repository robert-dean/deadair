// The order an import runs the lifecycle in, and what it refuses. The disk half is the installer's
// and has its own tests; here it is a double that records what it was asked to do, so the sequence
// is what is under test: an old instance disposed BEFORE the rescan, or it is orphaned.

import { describe, expect, it, vi } from 'vitest';
import { IsHttpError } from '@maroonedsoftware/errors';
import type { MultipartBody } from '@maroonedsoftware/multipart';
import type { PluginManifest } from '@deadair/plugin-sdk';

import type { AccessControlService } from '../../../src/modules/permissions/access.control.service.js';
import { PluginInstallService } from '../../../src/modules/plugins/plugin.install.service.js';
import type { PluginInstaller, StagedPlugin } from '../../../src/modules/plugins/plugin.installer.js';
import type { PluginLifecycleManager } from '../../../src/modules/plugins/plugin.lifecycle.manager.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginsService } from '../../../src/modules/plugins/plugins.service.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';

const UPLOAD = {} as MultipartBody;

function manifest(id: string, name: string): PluginManifest {
    return {
        id,
        name,
        version: '1.0.0',
        capabilities: ['charts'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: {} as PluginManifest['configSchema'],
    };
}

function record(overrides: Partial<PluginRecord> & Pick<PluginRecord, 'id'>): PluginRecord {
    return { dir: `/data/plugins/${overrides.id}`, origin: 'installed', status: 'active', manifest: manifest(overrides.id, 'Old'), ...overrides };
}

interface Harness {
    service: PluginInstallService;
    calls: string[];
    staged: StagedPlugin;
    installer: { place: ReturnType<typeof vi.fn> };
    activity: { record: ReturnType<typeof vi.fn> };
    accessControl: { require: ReturnType<typeof vi.fn> };
}

function harness(options: { existing?: PluginRecord; staged?: Partial<StagedPlugin>; namedDirs?: string[] } = {}): Harness {
    const calls: string[] = [];
    const registry = new PluginRegistry();
    if (options.existing) registry.upsert(options.existing);

    const staged: StagedPlugin = {
        id: 'example.charts',
        name: 'Example charts',
        packageName: 'example-charts',
        version: '1.1.0',
        targetDir: '/data/plugins/example-charts-1.1.0',
        stagedDir: '/data/plugins/.staging/x/plugin',
        restartRequired: false,
        discard: vi.fn(async () => {
            calls.push('discard');
        }),
        ...options.staged,
    };

    const installer = {
        exclusive: vi.fn(<T>(work: () => Promise<T>) => work()),
        stage: vi.fn(async () => {
            calls.push('stage');
            return staged;
        }),
        installedDirsNamed: vi.fn(async () => options.namedDirs ?? []),
        place: vi.fn(async (_staged: StagedPlugin, displaced: readonly string[]) => {
            calls.push(`place ${[...displaced].sort().join(',')}`);
        }),
        remove: vi.fn(async (dir: string) => {
            calls.push(`remove ${dir}`);
        }),
    };
    const lifecycle = {
        disposePlugin: vi.fn(async (id: string) => {
            calls.push(`dispose ${id}`);
        }),
        rescan: vi.fn(async () => {
            calls.push('rescan');
        }),
        initPlugin: vi.fn(async (id: string) => {
            calls.push(`init ${id}`);
        }),
    };
    const pluginsService = { listPlugins: vi.fn(async () => [{ id: 'example.charts' }]) };
    const accessControl = { require: vi.fn(async () => {}) };
    const activity = { record: vi.fn(async () => undefined) };

    const service = new PluginInstallService(
        installer as unknown as PluginInstaller,
        registry,
        lifecycle as unknown as PluginLifecycleManager,
        pluginsService as unknown as PluginsService,
        accessControl as unknown as AccessControlService,
        { actor: { kind: 'user', actorId: 'u-admin' } } as never,
        activity as never,
    );

    return { service, calls, staged, installer, activity, accessControl };
}

async function statusOf(promise: Promise<unknown>): Promise<number> {
    const caught = await promise.then(
        () => undefined,
        (error: unknown) => error,
    );
    if (!IsHttpError(caught)) throw new Error(`expected an HTTP refusal, got ${String(caught)}`);
    return caught.statusCode;
}

describe('PluginInstallService.importPlugin', () => {
    it('places a new plugin, rescans, and answers the catalogue with no restart', async () => {
        const { service, calls, activity } = harness();

        const result = await service.importPlugin(UPLOAD);

        expect(calls).toEqual(['stage', 'place ', 'rescan', 'init example.charts']);
        expect(result).toEqual({ pluginId: 'example.charts', restartRequired: false, plugins: [{ id: 'example.charts' }] });
        expect(activity.record).toHaveBeenCalledWith(
            expect.objectContaining({ module: 'plugins', kind: 'plugin.imported', data: { pluginId: 'example.charts' }, actorId: 'u-admin' }),
        );
    });

    it('disposes the running copy BEFORE the rescan, and takes every older folder of it away', async () => {
        const existing = record({ id: 'example.charts', dir: '/data/plugins/example-charts-1.0.0' });
        const { service, calls, accessControl } = harness({
            existing,
            namedDirs: ['/data/plugins/example-charts-0.9.0', '/data/plugins/example-charts-1.0.0'],
        });

        await service.importPlugin(UPLOAD);

        expect(calls).toEqual([
            'stage',
            'dispose example.charts',
            'place /data/plugins/example-charts-0.9.0,/data/plugins/example-charts-1.0.0',
            'rescan',
            'init example.charts',
        ]);
        expect(accessControl.require).toHaveBeenCalledWith({ namespace: 'plugin', id: 'example.charts' }, 'configure');
    });

    it('never lists the folder it is about to fill as one to take away', async () => {
        const existing = record({ id: 'example.charts', dir: '/data/plugins/example-charts-1.1.0' });
        const { service, calls } = harness({ existing, namedDirs: ['/data/plugins/example-charts-1.1.0'], staged: { restartRequired: true } });

        const result = await service.importPlugin(UPLOAD);

        expect(calls).toContain('place ');
        expect(result.restartRequired).toBe(true);
    });

    it('refuses a plugin claiming a bundled plugin id, moves nothing, and discards what it staged', async () => {
        const existing = record({ id: 'example.charts', origin: 'bundled', manifest: manifest('example.charts', 'Spotify') });
        const { service, calls, installer, activity } = harness({ existing });

        expect(await statusOf(service.importPlugin(UPLOAD))).toBe(409);

        expect(installer.place).not.toHaveBeenCalled();
        expect(calls).toEqual(['stage', 'discard']);
        expect(activity.record).not.toHaveBeenCalled();
    });

    it('discards what it staged when the caller may not configure the plugin it would replace', async () => {
        const existing = record({ id: 'example.charts' });
        const { service, calls, accessControl } = harness({ existing });
        const forbidden = Object.assign(new Error('forbidden'), { statusCode: 403 });
        accessControl.require.mockRejectedValue(forbidden);

        await expect(service.importPlugin(UPLOAD)).rejects.toBe(forbidden);

        expect(calls).toEqual(['stage', 'discard']);
    });
});

describe('PluginInstallService.removePlugin', () => {
    it('stops the plugin, deletes its folder, rescans, and answers the catalogue', async () => {
        const existing = record({ id: 'example.charts', dir: '/data/plugins/example-charts-1.0.0' });
        const { service, calls, activity, accessControl } = harness({ existing });

        const plugins = await service.removePlugin('example.charts');

        expect(calls).toEqual(['dispose example.charts', 'remove /data/plugins/example-charts-1.0.0', 'rescan']);
        expect(plugins).toEqual([{ id: 'example.charts' }]);
        expect(accessControl.require).toHaveBeenCalledWith({ namespace: 'plugin', id: 'example.charts' }, 'configure');
        expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'plugin.removed', data: { pluginId: 'example.charts' } }));
    });

    it('removes a plugin that never loaded, by the folder the loader read', async () => {
        const broken: PluginRecord = {
            id: 'broken-plugin-1.0.0',
            dir: '/data/plugins/broken-plugin-1.0.0',
            origin: 'installed',
            status: 'failed',
            error: 'nope',
        };
        const { service, calls } = harness({ existing: broken });

        await service.removePlugin('broken-plugin-1.0.0');

        expect(calls).toContain('remove /data/plugins/broken-plugin-1.0.0');
    });

    it('refuses a bundled plugin and touches nothing', async () => {
        const existing = record({ id: 'deadair.spotify', origin: 'bundled', manifest: manifest('deadair.spotify', 'Spotify') });
        const { service, calls, activity } = harness({ existing });

        expect(await statusOf(service.removePlugin('deadair.spotify'))).toBe(409);

        expect(calls).toEqual([]);
        expect(activity.record).not.toHaveBeenCalled();
    });

    it('answers 404 for a plugin the station does not have', async () => {
        const { service, calls } = harness();

        expect(await statusOf(service.removePlugin('nobody.here'))).toBe(404);
        expect(calls).toEqual([]);
    });
});
