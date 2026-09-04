// The operator's loop, which the first version of this plugin made impossible: the server URL
// cannot be tested until it is saved, and the models cannot be learned until it is tested. So a
// required default model asked for a name there was no way to find out. What replaces it is
// "save the address, press Test, read the names, come back", and every claim below is a step of it.

import { describe, expect, it } from 'vitest';
import { collectGeneration, isPluginError } from '@deadair/plugin-sdk';
import { createFakePluginHost } from '@deadair/plugin-sdk/testing';

import { LlmPlugin } from '../src/llm.plugin.js';

interface HostOptions {
    config?: Record<string, unknown>;
    /** What `GET /models` answers with, or a status to fail on. */
    models?: string[];
    status?: number;
    unreachable?: boolean;
}

function hostFor(options: HostOptions = {}) {
    const host = createFakePluginHost();

    host.setFetchImpl(async (url: string) => {
        if (options.unreachable === true) throw new Error('connect ECONNREFUSED');
        if (options.status !== undefined && options.status !== 200) {
            return new Response('nope', { status: options.status });
        }
        const data = (options.models ?? []).map(id => ({ id }));
        return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    host.seedConfig(options.config ?? {});

    return { host, calls: host.calls };
}

/** A loaded plugin, which is the only state any of this is meaningful in. */
async function loaded(options: HostOptions = {}) {
    const { host, calls } = hostFor(options);
    const plugin = new LlmPlugin();
    await plugin.init(host);
    return { plugin, calls };
}

describe('listing models', () => {
    it('reads the ids off the server', async () => {
        const { plugin } = await loaded({
            config: { baseUrl: 'https://models.test/v1' },
            models: ['gpt-oss:20b', 'llama3.2:1b'],
        });

        expect((await plugin.listModels()).map(model => model.id)).toEqual(['gpt-oss:20b', 'llama3.2:1b']);
    });

    it('marks the ones config says can take tools', async () => {
        const { plugin } = await loaded({
            config: { baseUrl: 'https://models.test/v1', models: 'gpt-oss:20b +tools' },
            models: ['gpt-oss:20b', 'llama3.2:1b'],
        });

        const models = await plugin.listModels();

        expect(models.find(model => model.id === 'gpt-oss:20b')?.tools).toBe(true);
        expect(models.find(model => model.id === 'llama3.2:1b')?.tools).toBe(false);
    });

    it('asks the server once and then uses what it heard', async () => {
        // On the path of every conversation that might use tools, so a round trip per
        // break to learn something that changes when an operator installs a model is a
        // poor trade.
        const { plugin, calls } = await loaded({ config: { baseUrl: 'https://models.test/v1' }, models: ['a'] });

        await plugin.listModels();
        await plugin.listModels();

        expect(calls.filter(call => call.url.endsWith('/models'))).toHaveLength(1);
    });

    it('answers from config rather than throwing when the server cannot be reached', async () => {
        // A blip should cost the console its list, not the station its ability to write.
        const { plugin } = await loaded({
            config: { baseUrl: 'https://models.test/v1', model: 'the-default', models: 'the-default +tools' },
            unreachable: true,
        });

        expect(await plugin.listModels()).toEqual([{ id: 'the-default', label: 'the-default', tools: true, default: true }]);
    });

    it('answers nothing at all when there is no server and no config', async () => {
        const { plugin } = await loaded({ config: { baseUrl: 'https://models.test/v1' }, models: [] });

        expect(await plugin.listModels()).toEqual([]);
    });
});

describe('testing the connection', () => {
    it('refuses before there is an address to test', async () => {
        const { plugin } = await loaded({ config: {} });

        await expect(plugin.testConnection()).resolves.toMatchObject({ ok: false });
    });

    it('does NOT require a default model, which is the whole point', async () => {
        // Requiring one here would be the same trap one field over: an operator cannot
        // name a model before this call tells them what there is.
        const { plugin } = await loaded({ config: { baseUrl: 'https://models.test/v1' }, models: ['gpt-oss:20b'] });

        await expect(plugin.testConnection()).resolves.toMatchObject({ ok: true });
    });

    it('says how many each provider has, and points at where the names are', async () => {
        // It used to list every name, because for a while this really was the only way to learn
        // them. It is not any more: `suggestConfigOptions` feeds the default-model field the same
        // listing, so the names are in that autocomplete — and with three providers configured,
        // spelling out every one of them here is a paragraph nobody reads.
        const { plugin } = await loaded({
            config: { baseUrl: 'https://models.test/v1' },
            models: ['gpt-oss:20b', 'llama3.2:1b'],
        });

        const result = await plugin.testConnection();

        expect(result.message).toContain('OpenAI-compatible: 2 model(s).');
        expect(result.message).toContain('Set one of them as the default model.');
    });

    it('says a configured model is not installed, rather than only "connected"', async () => {
        // "Connected" alone, with a model name that is not there, sends an operator
        // looking at the network for a fault that is a typo.
        const { plugin } = await loaded({
            config: { baseUrl: 'https://models.test/v1', model: 'not-installed' },
            models: ['gpt-oss:20b'],
        });

        const result = await plugin.testConnection();

        expect(result.ok).toBe(true);
        expect(result.message).toContain('not-installed');
        expect(result.message).toContain('is not one of them');
    });

    it('confirms plainly when the configured model is there', async () => {
        const { plugin } = await loaded({
            config: { baseUrl: 'https://models.test/v1', model: 'gpt-oss:20b' },
            models: ['gpt-oss:20b'],
        });

        await expect(plugin.testConnection()).resolves.toMatchObject({ ok: true, message: expect.stringContaining('Default model "gpt-oss:20b"') });
    });

    it('fails only when nothing answered at all', async () => {
        // One arm of three failing is worth saying in the sentence and is not a failed test: the
        // station can still write on the others, and a red result would claim otherwise.
        const host = createFakePluginHost();
        host.setFetchImpl(async (url: string) => {
            if (url.startsWith('https://api.anthropic.com')) {
                return new Response(JSON.stringify({ data: [{ id: 'claude-x' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
            }
            throw new Error('connect ECONNREFUSED');
        });
        host.seedConfig({ baseUrl: 'https://models.test/v1' });
        host.seedSecret('anthropicApiKey', 'sk-test');
        const plugin = new LlmPlugin();
        await plugin.init(host);

        const result = await plugin.testConnection();

        expect(result.ok).toBe(true);
        expect(result.message).toContain('Anthropic: 1 model(s).');
        expect(result.message).toContain('ECONNREFUSED');
    });

    it('reports a server that refused', async () => {
        const { plugin } = await loaded({ config: { baseUrl: 'https://models.test/v1' }, status: 401 });

        await expect(plugin.testConnection()).resolves.toMatchObject({ ok: false, message: expect.stringContaining('401') });
    });

    it('reports a server that could not be reached', async () => {
        const { plugin } = await loaded({ config: { baseUrl: 'https://models.test/v1' }, unreachable: true });

        await expect(plugin.testConnection()).resolves.toMatchObject({ ok: false });
    });

    it('says so when a server answers but lists nothing', async () => {
        const { plugin } = await loaded({ config: { baseUrl: 'https://models.test/v1' }, models: [] });

        await expect(plugin.testConnection()).resolves.toMatchObject({ ok: true, message: expect.stringContaining('no models') });
    });
});

describe('choosing which provider a request reaches', () => {
    it('reads a bare model name as the server URL, colons and all', async () => {
        // The live station's own default model is `gpt-oss-radio:latest`. A general "split on the
        // colon" rule would have routed it to a provider called `gpt-oss-radio`.
        const { plugin, calls } = await loaded({
            config: { baseUrl: 'https://models.test/v1', model: 'gpt-oss:20b' },
            models: ['gpt-oss:20b'],
        });

        // Drained, because `generate` hands back a handle before anything goes out: the request is
        // made when the words are read, which is what lets the host hold its slot until they stop.
        await collectGeneration(await plugin.generate({ messages: [{ role: 'user', content: 'go' }] })).catch(() => undefined);

        expect(calls.some(call => call.url.startsWith('https://models.test/v1'))).toBe(true);
    });

    it('refuses a model on a provider nothing is configured for, and names the credential', async () => {
        // Rather than "not configured", which is the difference between a field to fill in on the
        // form the operator is looking at and a mystery.
        const { plugin } = await loaded({ config: { baseUrl: 'https://models.test/v1' } });

        const error = await plugin.generate({ messages: [{ role: 'user', content: 'go' }], model: 'anthropic:claude-x' }).catch(e => e);

        expect(isPluginError(error) && error.code).toBe('config');
        expect(String(error)).toContain('Anthropic API key');
    });

    it('refuses a name that is a provider and no model', async () => {
        const { plugin } = await loaded({ config: { baseUrl: 'https://models.test/v1' } });

        const error = await plugin.generate({ messages: [{ role: 'user', content: 'go' }], model: 'anthropic:' }).catch(e => e);

        expect(isPluginError(error) && error.code).toBe('config');
    });

    it('refuses a generation when nothing at all is configured', async () => {
        const { plugin } = await loaded({ config: { model: 'gpt-x' } });

        const error = await plugin.generate({ messages: [{ role: 'user', content: 'go' }] }).catch(e => e);

        expect(isPluginError(error) && error.code).toBe('config');
        expect(String(error)).toContain('server URL');
    });

    it('loads an install configured before any of this, stale provider key and all', async () => {
        // The key is no longer declared, so it is simply not read. Everything else means what it
        // always meant, which is the whole reason a bare name is the OpenAI-compatible arm.
        const { plugin } = await loaded({
            config: { providerKind: 'openai-compat', baseUrl: 'https://models.test/v1', model: 'gpt-oss:20b' },
            models: ['gpt-oss:20b'],
        });

        expect(await plugin.listModels()).toEqual([{ id: 'gpt-oss:20b', label: 'gpt-oss:20b', tools: false, default: true }]);
    });
});

describe('listing what every provider has', () => {
    /** A host answering both a compatible server and Anthropic. */
    async function bothArms(config: Record<string, unknown> = {}) {
        const host = createFakePluginHost();
        host.setFetchImpl(async (url: string) => {
            const ids = url.startsWith('https://api.anthropic.com') ? ['claude-x'] : ['gpt-oss:20b'];
            return new Response(JSON.stringify({ data: ids.map(id => ({ id })) }), { status: 200, headers: { 'content-type': 'application/json' } });
        });
        host.seedConfig({ baseUrl: 'https://models.test/v1', ...config });
        host.seedSecret('anthropicApiKey', 'sk-test');
        const plugin = new LlmPlugin();
        await plugin.init(host);
        return { plugin, calls: host.calls };
    }

    it('answers the union, with the native arm qualified and the compatible one bare', async () => {
        const { plugin } = await bothArms();

        expect((await plugin.listModels()).map(model => model.id)).toEqual(['gpt-oss:20b', 'anthropic:claude-x']);
    });

    it('marks the default on whichever arm the default model actually names', async () => {
        const { plugin } = await bothArms({ model: 'anthropic:claude-x' });

        const described = await plugin.listModels();

        expect(described.find(model => model.default === true)?.id).toBe('anthropic:claude-x');
        expect(described.filter(model => model.default === true)).toHaveLength(1);
    });

    it('caches each arm separately rather than letting one evict the other', async () => {
        const { plugin, calls } = await bothArms();

        await plugin.listModels();
        await plugin.listModels();

        expect(calls.filter(call => call.url.startsWith('https://api.anthropic.com'))).toHaveLength(1);
        expect(calls.filter(call => call.url.startsWith('https://models.test'))).toHaveLength(1);
    });

    it('lets an unreachable provider contribute nothing rather than failing the list', async () => {
        // A momentary blip should cost the console some rows, not the station its ability to write.
        const host = createFakePluginHost();
        host.setFetchImpl(async (url: string) => {
            if (url.startsWith('https://api.anthropic.com')) throw new Error('connect ECONNREFUSED');
            return new Response(JSON.stringify({ data: [{ id: 'gpt-oss:20b' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
        });
        host.seedConfig({ baseUrl: 'https://models.test/v1' });
        host.seedSecret('anthropicApiKey', 'sk-test');
        const plugin = new LlmPlugin();
        await plugin.init(host);

        expect((await plugin.listModels()).map(model => model.id)).toEqual(['gpt-oss:20b']);
    });
});

describe('suggesting what the form should offer', () => {
    it('offers the server list for both the default model and the tool-capable ones', async () => {
        const { plugin } = await loaded({ config: { baseUrl: 'https://models.test/v1' }, models: ['gpt-oss:20b', 'llama3.2:1b'] });

        const suggested = await plugin.suggestConfigOptions();

        expect(suggested.model).toEqual([
            { value: 'gpt-oss:20b', label: 'gpt-oss:20b' },
            { value: 'llama3.2:1b', label: 'llama3.2:1b' },
        ]);
        expect(suggested.models).toEqual(suggested.model);
    });

    it('offers no models rather than throwing when the server cannot be reached', async () => {
        // An operator fixing a bad address needs the form, and the refresh control is right there.
        // The addresses survive, because that is the field somebody in this state is fixing.
        const { plugin } = await loaded({ config: { baseUrl: 'https://models.test/v1' }, unreachable: true });

        const suggested = await plugin.suggestConfigOptions();

        expect(suggested.model).toBeUndefined();
        expect(suggested.models).toBeUndefined();
        expect(suggested.baseUrl?.map(option => option.value)).toContain('https://api.openai.com/v1');
    });

    it('offers no models when the server lists nothing', async () => {
        // Absent rather than present-and-empty, so the form leaves those fields as plain inputs
        // instead of drawing a dropdown with no rows in it.
        const { plugin } = await loaded({ config: { baseUrl: 'https://models.test/v1' }, models: [] });

        const suggested = await plugin.suggestConfigOptions();

        expect(suggested.model).toBeUndefined();
        expect(suggested.models).toBeUndefined();
    });

    it("offers the tool-capable box only the compatible server's models, unqualified", async () => {
        // That question only means anything there: the native arms answer it themselves, and a
        // Claude model ticked in that box would be an operator confirming something already known.
        const host = createFakePluginHost();
        host.setFetchImpl(async (url: string) => {
            const ids = url.startsWith('https://api.anthropic.com') ? ['claude-x'] : ['gpt-oss:20b'];
            return new Response(JSON.stringify({ data: ids.map(id => ({ id })) }), { status: 200, headers: { 'content-type': 'application/json' } });
        });
        host.seedConfig({ baseUrl: 'https://models.test/v1' });
        host.seedSecret('anthropicApiKey', 'sk-test');
        const plugin = new LlmPlugin();
        await plugin.init(host);

        const suggested = await plugin.suggestConfigOptions();

        expect(suggested.models?.map(option => option.value)).toEqual(['gpt-oss:20b']);
        expect(suggested.model?.map(option => option.value)).toEqual(['gpt-oss:20b', 'anthropic:claude-x']);
    });

    it('shares the cache with listModels rather than asking twice', async () => {
        const { plugin, calls } = await loaded({ config: { baseUrl: 'https://models.test/v1' }, models: ['a'] });

        await plugin.suggestConfigOptions();
        await plugin.listModels();

        expect(calls.filter(call => call.url.endsWith('/models'))).toHaveLength(1);
    });
});

describe('generating without a model', () => {
    it('refuses with `config` rather than being refused at save time', async () => {
        // The trade: the form lets an address be saved alone, and this is where a
        // still-unset model is noticed, which is the moment somebody actually needs one.
        const { plugin } = await loaded({ config: { baseUrl: 'https://models.test/v1' }, models: ['a'] });

        await expect(plugin.generate({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({ code: 'config' });
    });
});
