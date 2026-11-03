// Which company a web search key reaches when the engine changes, through the real save path: the
// plugin's own schema judging the form as it will be, the host keeping whatever the form left out,
// and the plugin then asking its engine. Each half is pinned on its own elsewhere, and the bug this
// guards was in neither: a key kept by the host and passed by the schema went to the other company.

import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';

import { websearchManifest } from '../../../../../plugins/websearch/src/websearch.manifest.js';
import { WebSearchPlugin } from '../../../../../plugins/websearch/src/websearch.plugin.js';
import { PluginConfigService } from '../../../src/modules/plugins/plugin.config.service.js';
import type { PluginConfigRecord, PluginConfigRepository } from '../../../src/modules/plugins/plugin.config.repository.js';
import { formAsItWillBe } from '../../../src/modules/shared/config.rows.js';

const PLUGIN = websearchManifest.id;
const FIELDS = websearchManifest.configFields;
const SEARXNG = 'http://searxng:8080';

let row: PluginConfigRecord | undefined;
let configs: PluginConfigService;

/** What `PluginsService.updatePluginConfig` does: the schema first, then the save. Answers the fields refused. */
const save = async (submitted: Record<string, unknown>): Promise<string[]> => {
    const form = formAsItWillBe(FIELDS, await configs.getConfig(PLUGIN), await configs.getSecrets(PLUGIN), submitted);
    const judged = websearchManifest.configSchema.safeParse(form);
    if (!judged.success) return judged.error.issues.map(issue => issue.path.join('.'));

    await configs.saveConfig(PLUGIN, FIELDS, submitted);
    return [];
};

/** The one request the plugin makes, as it stands after the saves so far. */
const search = async (): Promise<FakePluginHost['calls'][number]> => {
    const host = createFakePluginHost();
    host.seedConfig(await configs.getConfig(PLUGIN));
    for (const [key, value] of Object.entries(await configs.getSecrets(PLUGIN))) host.seedSecret(key, value);

    const plugin = new WebSearchPlugin();
    await plugin.init(host);
    host.queueResponse({ status: 200, body: JSON.stringify({ results: [] }), headers: { 'content-type': 'application/json' } });
    await plugin.search({ query: 'portishead', limit: 1 });

    const call = host.calls[0];
    if (call === undefined) throw new Error('the plugin asked nobody');
    return call;
};

beforeEach(() => {
    row = undefined;
    const repository = {
        get: async () => row,
        upsert: async (saved: PluginConfigRecord) => (row = saved),
    };
    configs = new PluginConfigService(repository as unknown as PluginConfigRepository, new EncryptionProvider(randomBytes(32)));
});

describe('changing the web search engine', () => {
    it('refuses Brave to Tavily on Brave alone, under the key Tavily needs, and changes nothing', async () => {
        await save({ provider: 'brave', braveApiKey: 'brave-token' });

        expect(await save({ provider: 'tavily' })).toEqual(['tavilyApiKey']);
        expect((await search()).headers).toMatchObject({ 'X-Subscription-Token': 'brave-token' });
    });

    it('refuses Tavily to Brave on Tavily alone, under the key Brave needs, and changes nothing', async () => {
        await save({ provider: 'tavily', tavilyApiKey: 'tavily-key' });

        expect(await save({ provider: 'brave' })).toEqual(['braveApiKey']);
        expect((await search()).headers).toMatchObject({ Authorization: 'Bearer tavily-key' });
    });

    it('sends a retyped key to the new engine and not the old key', async () => {
        await save({ provider: 'brave', braveApiKey: 'brave-token' });

        expect(await save({ provider: 'tavily', tavilyApiKey: 'tavily-key' })).toEqual([]);

        const call = await search();
        expect(call.url).toContain('api.tavily.com');
        expect(call.headers).toMatchObject({ Authorization: 'Bearer tavily-key' });
        expect(JSON.stringify(call)).not.toContain('brave-token');
    });

    it('goes back to an engine on the key it issued, once it holds its own, with nothing retyped', async () => {
        await save({ provider: 'brave', braveApiKey: 'brave-token' });
        await save({ provider: 'tavily', tavilyApiKey: 'tavily-key' });

        expect(await save({ provider: 'brave' })).toEqual([]);

        const call = await search();
        expect(call.url).toContain('api.search.brave.com');
        expect(call.headers).toMatchObject({ 'X-Subscription-Token': 'brave-token' });
        expect(JSON.stringify(call)).not.toContain('tavily-key');
    });

    it('asks for no key moving to SearXNG, sends it none, and keeps what is stored', async () => {
        await save({ provider: 'brave', braveApiKey: 'brave-token' });

        expect(await save({ provider: 'searxng', baseUrl: SEARXNG })).toEqual([]);

        const call = await search();
        expect(call.url).toContain('searxng:8080');
        expect(JSON.stringify(call)).not.toContain('brave-token');
        expect((await configs.getSecrets(PLUGIN)).braveApiKey).toBe('brave-token');
    });

    it('comes back from SearXNG to the engine that issued the key with nothing retyped', async () => {
        await save({ provider: 'brave', braveApiKey: 'brave-token' });
        await save({ provider: 'searxng', baseUrl: SEARXNG });

        expect(await save({ provider: 'brave' })).toEqual([]);
        expect((await search()).headers).toMatchObject({ 'X-Subscription-Token': 'brave-token' });
    });

    it('does not let SearXNG launder a key on its way to the other engine', async () => {
        await save({ provider: 'brave', braveApiKey: 'brave-token' });
        await save({ provider: 'searxng', baseUrl: SEARXNG });

        expect(await save({ provider: 'tavily' })).toEqual(['tavilyApiKey']);
    });
});
