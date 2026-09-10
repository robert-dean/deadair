// The operator's loop, which the first version of this plugin made impossible: the server URL
// cannot be tested until it is saved, and the models cannot be learned until it is tested. So a
// required default model asked for a name there was no way to find out. What replaces it is
// "save the address, press Test, read the names, come back", and every claim below is a step of it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectGeneration, isPluginError } from '@deadair/plugin-sdk';
import { createFakePluginHost } from '@deadair/plugin-sdk/testing';

import { LlmPlugin } from '../src/llm.plugin.js';
import { MODEL_FAILURE_CACHE_MS } from '../src/llm.manifest.js';

interface HostOptions {
    /** `baseUrl` and `models` are shorthand for the one provider row most of these want. */
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

    host.seedConfig(asProviders(options.config ?? {}));

    return { host, calls: host.calls };
}

/**
 * The config these cases describe, as the form actually holds it.
 *
 * Most of them care about one OpenAI-compatible provider and say so by naming an address, which is
 * what this turns into a row of the providers table. The row is called `srv`, so every model on it
 * is `srv:…` — every name here is qualified now, because a station can have two of these.
 */
function asProviders(config: Record<string, unknown>): Record<string, unknown> {
    if (!('baseUrl' in config)) return config;

    const { baseUrl, ...rest } = config;
    return {
        providers: JSON.stringify([{ $id: 'r1', name: 'srv', kind: 'openai-compat', baseUrl }]),
        ...rest,
    };
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

        expect((await plugin.listModels()).map(model => model.id)).toEqual(['srv:gpt-oss:20b', 'srv:llama3.2:1b']);
    });

    it('marks the ones config says can take tools', async () => {
        const { plugin } = await loaded({
            config: { baseUrl: 'https://models.test/v1', models: JSON.stringify(['srv:gpt-oss:20b']) },
            models: ['gpt-oss:20b', 'llama3.2:1b'],
        });

        const models = await plugin.listModels();

        expect(models.find(model => model.id === 'srv:gpt-oss:20b')?.tools).toBe(true);
        expect(models.find(model => model.id === 'srv:llama3.2:1b')?.tools).toBe(false);
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
            config: { baseUrl: 'https://models.test/v1', model: 'srv:the-default', models: JSON.stringify(['srv:the-default']) },
            unreachable: true,
        });

        expect(await plugin.listModels()).toEqual([{ id: 'srv:the-default', label: 'the-default · srv', tools: true, default: true }]);
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

        expect(result.message).toContain('srv: 2 model(s).');
        expect(result.message).toContain('Set one of them as the default model.');
    });

    it('says a configured model is not installed, rather than only "connected"', async () => {
        // "Connected" alone, with a model name that is not there, sends an operator
        // looking at the network for a fault that is a typo.
        const { plugin } = await loaded({
            config: { baseUrl: 'https://models.test/v1', model: 'srv:not-installed' },
            models: ['gpt-oss:20b'],
        });

        const result = await plugin.testConnection();

        expect(result.ok).toBe(true);
        expect(result.message).toContain('not-installed');
        expect(result.message).toContain('is not one of them');
    });

    it('confirms plainly when the configured model is there', async () => {
        const { plugin } = await loaded({
            config: { baseUrl: 'https://models.test/v1', model: 'srv:gpt-oss:20b' },
            models: ['gpt-oss:20b'],
        });

        await expect(plugin.testConnection()).resolves.toMatchObject({
            ok: true,
            message: expect.stringContaining('Default model "srv:gpt-oss:20b"'),
        });
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
        host.seedConfig({
            providers: JSON.stringify([
                { $id: 'r1', name: 'srv', kind: 'openai-compat', baseUrl: 'https://models.test/v1' },
                { $id: 'r2', name: 'claude', kind: 'anthropic' },
            ]),
        });
        host.seedSecret('providers/r2/apiKey', 'sk-test');
        const plugin = new LlmPlugin();
        await plugin.init(host);

        const result = await plugin.testConnection();

        expect(result.ok).toBe(true);
        expect(result.message).toContain('claude: 1 model(s).');
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
            config: { baseUrl: 'https://models.test/v1', model: 'srv:gpt-oss:20b' },
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
        expect(String(error)).toContain('there is no provider by that name');
    });

    it('refuses a name that is a provider and no model', async () => {
        const { plugin } = await loaded({ config: { baseUrl: 'https://models.test/v1' } });

        const error = await plugin.generate({ messages: [{ role: 'user', content: 'go' }], model: 'anthropic:' }).catch(e => e);

        expect(isPluginError(error) && error.code).toBe('config');
    });

    it('refuses an unqualified model name rather than guessing at one', async () => {
        // "The first row" would be a rule that changes meaning the moment somebody reorders the
        // table, so the sentence says what a name is supposed to look like instead.
        const { plugin } = await loaded({ config: { model: 'gpt-x' } });

        const error = await plugin.generate({ messages: [{ role: 'user', content: 'go' }] }).catch(e => e);

        expect(isPluginError(error) && error.code).toBe('config');
        expect(String(error)).toContain('provider:model');
    });

    it('names the credential when the row is there but half filled in', async () => {
        // A different repair from "there is no such provider", and it reads differently on the form:
        // this one is a cell to fill in.
        const host = createFakePluginHost();
        host.seedConfig({ providers: JSON.stringify([{ $id: 'r1', name: 'claude', kind: 'anthropic' }]) });
        const plugin = new LlmPlugin();
        await plugin.init(host);

        const error = await plugin.generate({ messages: [{ role: 'user', content: 'go' }], model: 'claude:x' }).catch(e => e);

        expect(isPluginError(error) && error.code).toBe('config');
        expect(String(error)).toContain('no API key');
    });

    it('loads an install configured before any of this, stale provider key and all', async () => {
        // The key is no longer declared, so it is simply not read. Everything else means what it
        // always meant, which is the whole reason a bare name is the OpenAI-compatible arm.
        const { plugin } = await loaded({
            config: { providerKind: 'openai-compat', baseUrl: 'https://models.test/v1', model: 'gpt-oss:20b' },
            models: ['gpt-oss:20b'],
        });

        expect(await plugin.listModels()).toEqual([{ id: 'srv:gpt-oss:20b', label: 'gpt-oss:20b · srv', tools: false }]);
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
        host.seedConfig({
            providers: JSON.stringify([
                { $id: 'r1', name: 'srv', kind: 'openai-compat', baseUrl: 'https://models.test/v1' },
                { $id: 'r2', name: 'claude', kind: 'anthropic' },
            ]),
            ...config,
        });
        host.seedSecret('providers/r2/apiKey', 'sk-test');
        const plugin = new LlmPlugin();
        await plugin.init(host);
        return { plugin, calls: host.calls };
    }

    it('answers the union, with the native arm qualified and the compatible one bare', async () => {
        const { plugin } = await bothArms();

        expect((await plugin.listModels()).map(model => model.id)).toEqual(['srv:gpt-oss:20b', 'claude:claude-x']);
    });

    it('marks the default on whichever arm the default model actually names', async () => {
        const { plugin } = await bothArms({ model: 'claude:claude-x' });

        const described = await plugin.listModels();

        expect(described.find(model => model.default === true)?.id).toBe('claude:claude-x');
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
        host.seedConfig({
            providers: JSON.stringify([
                { $id: 'r1', name: 'srv', kind: 'openai-compat', baseUrl: 'https://models.test/v1' },
                { $id: 'r2', name: 'claude', kind: 'anthropic' },
            ]),
        });
        host.seedSecret('providers/r2/apiKey', 'sk-test');
        const plugin = new LlmPlugin();
        await plugin.init(host);

        expect((await plugin.listModels()).map(model => model.id)).toEqual(['srv:gpt-oss:20b']);
    });

    it('asks every arm at once rather than waiting for one before starting the next', async () => {
        // Each arm can take up to the probe timeout on its own; two of them one after another
        // would be roughly double this delay, and together roughly one.
        const DELAY_MS = 50;
        const host = createFakePluginHost();
        host.setFetchImpl(async (url: string) => {
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            const ids = url.startsWith('https://api.anthropic.com') ? ['claude-x'] : ['gpt-oss:20b'];
            return new Response(JSON.stringify({ data: ids.map(id => ({ id })) }), { status: 200, headers: { 'content-type': 'application/json' } });
        });
        host.seedConfig({
            providers: JSON.stringify([
                { $id: 'r1', name: 'srv', kind: 'openai-compat', baseUrl: 'https://models.test/v1' },
                { $id: 'r2', name: 'claude', kind: 'anthropic' },
            ]),
        });
        host.seedSecret('providers/r2/apiKey', 'sk-test');
        const plugin = new LlmPlugin();
        await plugin.init(host);

        const started = Date.now();
        await plugin.listModels();
        const elapsed = Date.now() - started;

        expect(elapsed).toBeLessThan(DELAY_MS * 1.6);
    });

    it('orders the answers by the arms’ own order, regardless of which one settled first', async () => {
        const host = createFakePluginHost();
        host.setFetchImpl(async (url: string) => {
            if (url.startsWith('https://api.anthropic.com')) {
                // The row registered second answers first.
                return new Response(JSON.stringify({ data: [{ id: 'claude-x' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
            }
            await new Promise(resolve => setTimeout(resolve, 30));
            return new Response(JSON.stringify({ data: [{ id: 'gpt-oss:20b' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
        });
        host.seedConfig({
            providers: JSON.stringify([
                { $id: 'r1', name: 'srv', kind: 'openai-compat', baseUrl: 'https://models.test/v1' },
                { $id: 'r2', name: 'claude', kind: 'anthropic' },
            ]),
        });
        host.seedSecret('providers/r2/apiKey', 'sk-test');
        const plugin = new LlmPlugin();
        await plugin.init(host);

        expect((await plugin.listModels()).map(model => model.id)).toEqual(['srv:gpt-oss:20b', 'claude:claude-x']);
    });
});

describe('remembering a failed listing', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('probes a dead provider once, answers from the failure cache inside the window, then probes again after it', async () => {
        vi.useFakeTimers();

        let fetchCount = 0;
        const { host } = hostFor({ config: { baseUrl: 'https://models.test/v1' } });
        host.setFetchImpl(async () => {
            fetchCount += 1;
            throw new Error('connect ECONNREFUSED');
        });
        const plugin = new LlmPlugin();
        await plugin.init(host);

        await plugin.listModels();
        expect(fetchCount).toBe(1);

        await plugin.listModels();
        expect(fetchCount).toBe(1);

        vi.setSystemTime(Date.now() + MODEL_FAILURE_CACHE_MS + 1);

        await plugin.listModels();
        expect(fetchCount).toBe(2);
    });
});

describe('suggesting what the form should offer', () => {
    it('offers the server list for both the default model and the tool-capable ones', async () => {
        const { plugin } = await loaded({ config: { baseUrl: 'https://models.test/v1' }, models: ['gpt-oss:20b', 'llama3.2:1b'] });

        const suggested = await plugin.suggestConfigOptions();

        expect(suggested.model).toEqual([
            { value: 'srv:gpt-oss:20b', label: 'gpt-oss:20b · srv' },
            { value: 'srv:llama3.2:1b', label: 'llama3.2:1b · srv' },
        ]);
        // The same list, because this provider cannot answer the tool question itself.
        expect(suggested.models).toEqual(suggested.model);
    });

    it('offers no models rather than throwing when the server cannot be reached', async () => {
        // An operator fixing a bad address needs the form, and the refresh control is right there.
        // The addresses survive, because that is the field somebody in this state is fixing.
        const { plugin } = await loaded({ config: { baseUrl: 'https://models.test/v1' }, unreachable: true });

        const suggested = await plugin.suggestConfigOptions();

        expect(suggested.model).toBeUndefined();
        expect(suggested.models).toBeUndefined();
        expect(suggested['providers.baseUrl']?.map(option => option.value)).toContain('https://api.openai.com/v1');
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
        host.seedConfig({
            providers: JSON.stringify([
                { $id: 'r1', name: 'srv', kind: 'openai-compat', baseUrl: 'https://models.test/v1' },
                { $id: 'r2', name: 'claude', kind: 'anthropic' },
            ]),
        });
        host.seedSecret('providers/r2/apiKey', 'sk-test');
        const plugin = new LlmPlugin();
        await plugin.init(host);

        const suggested = await plugin.suggestConfigOptions();

        expect(suggested.models?.map(option => option.value)).toEqual(['srv:gpt-oss:20b']);
        expect(suggested.model?.map(option => option.value)).toEqual(['srv:gpt-oss:20b', 'claude:claude-x']);
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
