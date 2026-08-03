import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { assertCrossesBoundary, conformanceManifest } from '../../../../../packages/plugin-sdk/tests/boundary.payloads.fixture.js';
import { PLUGIN_OAUTH_SECRET_KEY, PluginHostFactory, PluginHostFactoryOptions } from '../../../src/modules/plugins/plugin.host.factory.js';
import type { PluginConfigService } from '../../../src/modules/plugins/plugin.config.service.js';
import type { PluginEchoTracker } from '../../../src/modules/plugins/plugin.echo.tracker.js';
import type { PluginStorageRepository } from '../../../src/modules/plugins/plugin.storage.repository.js';

const PLUGIN_ID = 'test.conformance';

const stubLogger = (): Logger => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
});

interface Harness {
    factory: PluginHostFactory;
    getSecrets: ReturnType<typeof vi.fn>;
    getConfig: ReturnType<typeof vi.fn>;
    saveConfig: ReturnType<typeof vi.fn>;
    storageGet: ReturnType<typeof vi.fn>;
    storageListKeys: ReturnType<typeof vi.fn>;
}

/**
 * A real `PluginHostFactory` around hand-stubbed collaborators. Constructor
 * injection means plain `new` with stubs is enough: no DI container needed.
 * This is the boundary the SDK's fixture-driven test cannot see: the real
 * factory output, so the host cannot drift from the SDK's JSON-safe promise.
 */
function harness(): Harness {
    const getSecrets = vi.fn(async (_pluginId: string) => ({}) as Record<string, string>);
    const getConfig = vi.fn(async (_pluginId: string) => ({ region: 'us' }) as Record<string, unknown>);
    const saveConfig = vi.fn(async () => {});
    const storageGet = vi.fn(async (_pluginId: string, _key: string) => ({ cursor: 'abc' }) as unknown);
    const storageListKeys = vi.fn(async (_pluginId: string, _prefix?: string) => ['a', 'b']);

    const pluginConfigService = { getSecrets, getConfig, saveConfig } as unknown as PluginConfigService;
    const pluginStorageRepository = {
        get: storageGet,
        set: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        listKeys: storageListKeys,
    } as unknown as PluginStorageRepository;
    const pluginEchoTracker = { expectEcho: vi.fn(), retractEcho: vi.fn() } as unknown as PluginEchoTracker;

    const options = new PluginHostFactoryOptions('https://host.example.com');
    const factory = new PluginHostFactory(options, pluginConfigService, pluginStorageRepository, pluginEchoTracker, stubLogger());

    return { factory, getSecrets, getConfig, saveConfig, storageGet, storageListKeys };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('PluginHostFactory boundary conformance', () => {
    it('flattens a real fetch Response into a JSON-safe HostFetchResponse', async () => {
        const h = harness();
        const manifest = conformanceManifest({ permissions: { network: ['api.example.com'], storage: true, oauth: true } });
        const host = h.factory.createHost(manifest);

        const response = new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json', 'x-request-id': 'req-1' },
        });
        vi.stubGlobal('fetch', vi.fn(async () => response));

        const result = await host.fetch('https://api.example.com/tracks');

        expect(() => assertCrossesBoundary(result, 'host.fetch result')).not.toThrow();
        expect(result).toEqual({
            status: 200,
            headers: { 'content-type': 'application/json', 'x-request-id': 'req-1' },
            body: JSON.stringify({ ok: true }),
            ok: true,
        });
    });

    it('returns a plain string from oauth.getRedirectUri', async () => {
        const h = harness();
        const manifest = conformanceManifest();
        const host = h.factory.createHost(manifest);

        const redirectUri = await host.oauth.getRedirectUri();

        expect(() => assertCrossesBoundary({ redirectUri }, 'oauth redirect uri')).not.toThrow();
        expect(typeof redirectUri).toBe('string');
    });

    it('returns a plain Record<string,string> from oauth.getTokens', async () => {
        const h = harness();
        h.getSecrets.mockResolvedValueOnce({
            [PLUGIN_OAUTH_SECRET_KEY]: JSON.stringify({ accessToken: 'a', refreshToken: 'b' }),
        });
        const manifest = conformanceManifest();
        const host = h.factory.createHost(manifest);

        const tokens = await host.oauth.getTokens();

        expect(() => assertCrossesBoundary(tokens, 'oauth tokens')).not.toThrow();
        expect(tokens).toEqual({ accessToken: 'a', refreshToken: 'b' });
    });

    it('returns undefined from oauth.getTokens when the plugin never authorized', async () => {
        const h = harness();
        h.getSecrets.mockResolvedValueOnce({});
        const manifest = conformanceManifest();
        const host = h.factory.createHost(manifest);

        const tokens = await host.oauth.getTokens();

        expect(() => assertCrossesBoundary({ tokens }, 'unset oauth tokens')).not.toThrow();
        expect(tokens).toBeUndefined();
    });

    it('returns JSON-safe values from storage.get and storage.list', async () => {
        const h = harness();
        const manifest = conformanceManifest({ permissions: { network: [], storage: true, oauth: false } });
        const host = h.factory.createHost(manifest);

        const value = await host.storage.get('cursor');
        const keys = await host.storage.list();

        expect(() => assertCrossesBoundary(value, 'storage.get result')).not.toThrow();
        expect(() => assertCrossesBoundary(keys, 'storage.list result')).not.toThrow();
        expect(value).toEqual({ cursor: 'abc' });
        expect(keys).toEqual(['a', 'b']);
    });

    it('returns a JSON-safe value from config.get', async () => {
        const h = harness();
        const manifest = conformanceManifest();
        const host = h.factory.createHost(manifest);

        const config = await host.config.get();

        expect(() => assertCrossesBoundary(config, 'config.get result')).not.toThrow();
        expect(config).toEqual({ region: 'us' });
    });
});
