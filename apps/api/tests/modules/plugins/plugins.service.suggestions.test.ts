// `ConfigField.options` is fixed when the manifest is written, which cannot express anything the
// operator's own server decides. This is the dynamic half, and the claim under test is that it never
// costs the form: a plugin with nothing to say, a plugin that cannot reach its upstream, and a
// plugin that answers with nonsense all leave a usable settings page behind.

import { describe, expect, it, vi } from 'vitest';
import { AfterCommit } from '../../../src/modules/data/after.commit.js';
import { AccessControlService } from '../../../src/modules/permissions/access.control.service.js';
import { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { PluginOAuthStateStore } from '../../../src/modules/plugins/plugin.oauth.state.store.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import { PluginsService } from '../../../src/modules/plugins/plugins.service.js';
import type { PluginConfigService } from '../../../src/modules/plugins/plugin.config.service.js';
import type { PluginLifecycleManager } from '../../../src/modules/plugins/plugin.lifecycle.manager.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

const PLUGIN_ID = 'deadair.example';

/** Everything past the suggestion call is somebody else's test; this waves it all through. */
const permissive = () =>
    ({
        require: vi.fn(async () => {}),
        canAccess: vi.fn(async () => true),
        listVisibleIds: vi.fn(async () => ({ all: true, ids: [] })),
    }) as unknown as AccessControlService;

function serviceWith(instance: Record<string, unknown> | undefined) {
    const registry = new PluginRegistry();
    registry.upsert({
        id: PLUGIN_ID,
        dir: '/plugins/example',
        status: 'active',
        manifest: { id: PLUGIN_ID, name: 'Example', version: '1', capabilities: [], apiVersion: '^1.0.0', configFields: [] },
        instance,
    } as unknown as PluginRecord);

    return new PluginsService(
        registry,
        {
            getReadModel: vi.fn(async (id: string) => ({ pluginId: id, enabled: true, config: {}, configured: {}, oauthConnected: false })),
        } as unknown as PluginConfigService,
        new PluginInvoker(registry, stubPluginLog().log),
        { rescan: vi.fn(), reinitPlugin: vi.fn() } as unknown as PluginLifecycleManager,
        new PluginOAuthStateStore(),
        permissive(),
        stubPluginLog().log,
        new AfterCommit(),
        { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    );
}

describe('asking a plugin what to suggest', () => {
    it('answers with what the plugin offered', async () => {
        const service = serviceWith({
            suggestConfigOptions: async () => ({ model: [{ value: 'gpt-oss:20b', label: 'gpt-oss:20b' }] }),
        });

        await expect(service.suggestPluginConfigOptions(PLUGIN_ID)).resolves.toEqual({
            fields: { model: [{ value: 'gpt-oss:20b', label: 'gpt-oss:20b' }] },
            supported: true,
        });
    });

    it('reports `supported: false` for a plugin that does not implement it', async () => {
        // So a console can tell "nothing to suggest" from "asked and got nothing", and leave the
        // refresh control off a plugin where it would do nothing.
        const service = serviceWith({});

        await expect(service.suggestPluginConfigOptions(PLUGIN_ID)).resolves.toEqual({ fields: {}, supported: false });
    });

    it('reports `supported: false` for a plugin that is not running', async () => {
        const service = serviceWith(undefined);

        await expect(service.suggestPluginConfigOptions(PLUGIN_ID)).resolves.toEqual({ fields: {}, supported: false });
    });

    it('stays supported but empty when the plugin threw', async () => {
        // An unreachable upstream costs the dropdowns, never the form. Still `supported`, because
        // refreshing after fixing the address is exactly what an operator should do next.
        const service = serviceWith({
            suggestConfigOptions: async () => {
                throw new Error('connect ECONNREFUSED');
            },
        });

        await expect(service.suggestPluginConfigOptions(PLUGIN_ID)).resolves.toEqual({ fields: {}, supported: true });
    });
});

describe('making a plugin answer renderable', () => {
    const suggesting = (value: unknown) => serviceWith({ suggestConfigOptions: async () => value });

    it('fills a missing label from the value, which is the ordinary case for a list of ids', async () => {
        const service = suggesting({ model: [{ value: 'gpt-oss:20b' }] });

        const result = await service.suggestPluginConfigOptions(PLUGIN_ID);

        expect(result.fields.model).toEqual([{ value: 'gpt-oss:20b', label: 'gpt-oss:20b' }]);
    });

    it('drops entries with no usable value rather than rendering blanks', async () => {
        const service = suggesting({ model: [{ value: '' }, { label: 'no value' }, null, 'a string', { value: 'ok' }] });

        const result = await service.suggestPluginConfigOptions(PLUGIN_ID);

        expect(result.fields.model).toEqual([{ value: 'ok', label: 'ok' }]);
    });

    it('leaves out a field whose options were all unusable, rather than reporting it empty', async () => {
        const service = suggesting({ model: [{ value: '' }] });

        const result = await service.suggestPluginConfigOptions(PLUGIN_ID);

        expect(result.fields.model).toBeUndefined();
    });

    it('ignores a field whose value is not a list', async () => {
        const service = suggesting({ model: 'gpt-oss:20b' });

        await expect(service.suggestPluginConfigOptions(PLUGIN_ID)).resolves.toMatchObject({ fields: {} });
    });

    it('survives a plugin answering with something that is not an object at all', async () => {
        // Plugins are trusted code, so this is not a security boundary. It is the same care
        // `toPluginError` takes: the value is about to be JSON and then a form.
        for (const answer of [undefined, null, 'nope', 42, []]) {
            await expect(suggesting(answer).suggestPluginConfigOptions(PLUGIN_ID)).resolves.toMatchObject({ fields: {} });
        }
    });

    it('caps a very long list rather than handing the console ten thousand rows', async () => {
        const many = Array.from({ length: 5_000 }, (_, index) => ({ value: `m${index}`, label: `m${index}` }));
        const service = suggesting({ model: many });

        const result = await service.suggestPluginConfigOptions(PLUGIN_ID);

        expect(result.fields.model?.length).toBe(500);
    });
});
