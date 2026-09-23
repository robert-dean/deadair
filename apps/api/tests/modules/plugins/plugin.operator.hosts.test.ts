// Which servers the operator pointed an enabled plugin at. The art fetch trusts these and nothing
// else to be on the LAN, so what is pinned here is both halves: every address a `fromConfig` setting
// names is in, by host and port, and nothing the operator did not type is.

import { describe, expect, it, vi } from 'vitest';
import type { ConfigField, PluginManifest } from '@deadair/plugin-sdk';

import type { PluginConfigRepository } from '../../../src/modules/plugins/plugin.config.repository.js';
import { PluginOperatorHosts } from '../../../src/modules/plugins/plugin.operator.hosts.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';

function record(id: string, network: PluginManifest['permissions']['network'], configFields: ConfigField[] = []): PluginRecord {
    const manifest = { id, name: id, version: '1.0.0', capabilities: [], configFields, permissions: { network, storage: false, oauth: false } };
    return { id, dir: `/plugins/${id}`, origin: 'bundled', status: 'active', manifest } as unknown as PluginRecord;
}

interface Row {
    pluginId: string;
    enabled: boolean;
    config: Record<string, unknown>;
}

function build(records: PluginRecord[], rows: Row[]): PluginOperatorHosts {
    const registry = new PluginRegistry();
    registry.setAll(records);
    const configs = { list: vi.fn(async () => rows) } as unknown as PluginConfigRepository;
    return new PluginOperatorHosts(registry, configs);
}

describe('PluginOperatorHosts.list', () => {
    it("names the server an enabled plugin's address setting points at, port and all", async () => {
        const hosts = build(
            [record('navidrome', [{ fromConfig: 'baseUrl', ratePerSecond: 5 }])],
            [{ pluginId: 'navidrome', enabled: true, config: { baseUrl: 'http://192.168.1.10:4533' } }],
        );

        expect([...(await hosts.list())]).toEqual(['192.168.1.10:4533']);
    });

    it('reads a bare hostname the way the allowlist does', async () => {
        const hosts = build(
            [record('analyzer', [{ fromConfig: 'baseUrl' }])],
            [{ pluginId: 'analyzer', enabled: true, config: { baseUrl: ' NAS.lan:8765 ' } }],
        );

        expect([...(await hosts.list())]).toEqual(['nas.lan:8765']);
    });

    it('leaves out a disabled plugin, a manifest literal, and a plugin that is not loaded', async () => {
        const hosts = build(
            [record('navidrome', [{ fromConfig: 'baseUrl' }]), record('deezer', ['api.deezer.com'])],
            [
                { pluginId: 'navidrome', enabled: false, config: { baseUrl: 'http://192.168.1.10:4533' } },
                { pluginId: 'deezer', enabled: true, config: {} },
                { pluginId: 'gone', enabled: true, config: { baseUrl: 'http://10.0.0.2' } },
            ],
        );

        expect((await hosts.list()).size).toBe(0);
    });

    it('reads every address a multi-line setting and a list setting name', async () => {
        const providers: ConfigField = {
            key: 'providers',
            label: 'Providers',
            type: 'list',
            columns: [
                { key: 'label', label: 'Label', type: 'text' },
                { key: 'url', label: 'Address', type: 'url' },
            ],
        } as ConfigField;
        const hosts = build(
            [record('rss', [{ fromConfig: 'feeds' }]), record('llm', [{ fromConfig: 'providers' }], [providers])],
            [
                { pluginId: 'rss', enabled: true, config: { feeds: 'Local | http://feeds.lan/a.xml\nhttps://example.com/b.xml' } },
                {
                    pluginId: 'llm',
                    enabled: true,
                    config: { providers: JSON.stringify([{ id: 'r1', label: 'sport', url: 'http://localhost:11434' }]) },
                },
            ],
        );

        expect([...(await hosts.list())].sort()).toEqual(['example.com', 'feeds.lan', 'localhost:11434']);
    });
});
