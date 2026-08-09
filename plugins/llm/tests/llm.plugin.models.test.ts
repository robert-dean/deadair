// The operator's loop, which the first version of this plugin made impossible: the server URL
// cannot be tested until it is saved, and the models cannot be learned until it is tested. So a
// required default model asked for a name there was no way to find out. What replaces it is
// "save the address, press Test, read the names, come back", and every claim below is a step of it.

import { describe, expect, it, vi } from 'vitest';
import type { PluginHost } from '@deadair/plugin-sdk';

import { LlmPlugin } from '../src/llm.plugin.js';

interface HostOptions {
    config?: Record<string, unknown>;
    /** What `GET /models` answers with, or a status to fail on. */
    models?: string[];
    status?: number;
    unreachable?: boolean;
}

function hostFor(options: HostOptions = {}) {
    const calls: string[] = [];

    const fetch = vi.fn(async (url: string) => {
        calls.push(url);
        if (options.unreachable === true) throw new Error('connect ECONNREFUSED');
        if (options.status !== undefined && options.status !== 200) {
            return new Response('nope', { status: options.status });
        }
        const data = (options.models ?? []).map(id => ({ id }));
        return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const host = {
        fetch,
        config: { get: async () => options.config ?? {} },
        secrets: { get: async () => undefined },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        signal: new AbortController().signal,
    } as unknown as PluginHost;

    return { host, calls };
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

        expect(calls.filter(url => url.endsWith('/models'))).toHaveLength(1);
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

    it('says the model names out loud, because nothing else will', async () => {
        const { plugin } = await loaded({
            config: { baseUrl: 'https://models.test/v1' },
            models: ['gpt-oss:20b', 'llama3.2:1b'],
        });

        const result = await plugin.testConnection();

        expect(result.message).toContain('gpt-oss:20b');
        expect(result.message).toContain('llama3.2:1b');
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
        expect(result.message).toContain('gpt-oss:20b');
    });

    it('confirms plainly when the configured model is there', async () => {
        const { plugin } = await loaded({
            config: { baseUrl: 'https://models.test/v1', model: 'gpt-oss:20b' },
            models: ['gpt-oss:20b'],
        });

        await expect(plugin.testConnection()).resolves.toMatchObject({ ok: true, message: expect.stringContaining('gpt-oss:20b') });
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

describe('generating without a model', () => {
    it('refuses with `config` rather than being refused at save time', async () => {
        // The trade: the form lets an address be saved alone, and this is where a
        // still-unset model is noticed, which is the moment somebody actually needs one.
        const { plugin } = await loaded({ config: { baseUrl: 'https://models.test/v1' }, models: ['a'] });

        await expect(plugin.generate({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({ code: 'config' });
    });
});
