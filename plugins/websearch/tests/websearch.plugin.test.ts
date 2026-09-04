// The plugin itself: what it asks for, of whom, and what it does when the
// operator has not finished filling in the form. The mappings are pinned next
// door in websearch.parsers.test.ts; what is under test here is the dispatch,
// the request each engine actually receives, and the failures the station has to
// be able to tell apart.

import { beforeEach, describe, expect, it } from 'vitest';
import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';

import { WebSearchPlugin } from '../src/websearch.plugin.js';
import { BRAVE_HOST, REQUEST_TIMEOUT_MS, TAVILY_HOST, websearchManifest } from '../src/websearch.manifest.js';

let host: FakePluginHost;
let plugin: WebSearchPlugin;

/**
 * Seeds the form as the HOST would store it: a `secret` field goes to the secrets store and can
 * never be in `config`. Seeding it into config is what hid a live bug where the key was read from
 * the wrong place and every keyed engine was called without one.
 */
const initialize = async (config: Record<string, unknown>): Promise<void> => {
    const { apiKey, ...plain } = config;
    host.seedConfig(plain);
    if (typeof apiKey === 'string') host.seedSecret('apiKey', apiKey);
    await plugin.init(host);
};

const queueJson = (body: unknown, status = 200): void =>
    host.queueResponse({ status, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

const searxngHit = { title: 'Portishead', content: 'A band from Bristol.', url: 'https://example.com/portishead' };

beforeEach(() => {
    host = createFakePluginHost();
    plugin = new WebSearchPlugin();
});

describe('manifest', () => {
    it('declares the two capabilities it implements', () => {
        expect(websearchManifest.capabilities).toEqual(['search', 'enrichment']);
    });

    it("allows the two managed engines outright and the operator's own addresses from the form", () => {
        expect(websearchManifest.permissions.network).toEqual([
            expect.objectContaining({ fromConfig: 'baseUrl' }),
            expect.objectContaining({ host: BRAVE_HOST }),
            expect.objectContaining({ host: TAVILY_HOST }),
            expect.objectContaining({ fromConfig: 'trustedSites' }),
        ]);
    });

    it('asks for no open-web grant, which is what makes the trusted list a boundary', () => {
        // The whole trust mechanism. With a `network.open` grant this would be a
        // plugin that can read any page a search returns and promises to be
        // careful; without one, the host refuses everything off the operator's
        // list before this plugin sees it.
        expect(websearchManifest.permissions.grants ?? []).toEqual([]);
    });

    it('reads the trusted addresses off a column the host also reads', () => {
        // The host's allowlist takes the cells of the columns declared `url` and
        // no others. A column typed anything else is a site the operator
        // believes they trusted and the plugin can never reach.
        const sites = websearchManifest.configFields.find(field => field.key === 'trustedSites');

        expect(sites?.type).toBe('list');
        expect(sites?.columns?.find(column => column.key === 'site')?.type).toBe('url');
    });

    it('keeps nothing and holds no account of its own', () => {
        expect(websearchManifest.permissions.storage).toBe(false);
        expect(websearchManifest.permissions.oauth).toBe(false);
    });

    it('refuses to save SearXNG with no address, where there is somebody to tell', () => {
        const answer = websearchManifest.configSchema.safeParse({ provider: 'searxng', apiKey: 'irrelevant' });

        expect(answer.success).toBe(false);
    });

    it('refuses to save a keyed engine with no key', () => {
        expect(websearchManifest.configSchema.safeParse({ provider: 'brave' }).success).toBe(false);
        expect(websearchManifest.configSchema.safeParse({ provider: 'tavily', apiKey: '   ' }).success).toBe(false);
    });

    it('accepts a complete form', () => {
        expect(websearchManifest.configSchema.safeParse({ provider: 'searxng', baseUrl: 'http://searxng:8080' }).success).toBe(true);
        expect(websearchManifest.configSchema.safeParse({ provider: 'brave', apiKey: 'token' }).success).toBe(true);
    });
});

describe('an unconfigured plugin', () => {
    it('answers with nothing and asks nobody', async () => {
        await initialize({});

        await expect(plugin.search({ query: 'portishead', limit: 5 })).resolves.toEqual([]);
        expect(host.calls).toHaveLength(0);
    });

    it('says so when the operator presses test', async () => {
        await initialize({});

        await expect(plugin.testConnection()).resolves.toMatchObject({ ok: false });
    });

    it('does nothing with an engine name it does not recognise, rather than throwing', async () => {
        await initialize({ provider: 'altavista' });

        await expect(plugin.search({ query: 'portishead', limit: 5 })).resolves.toEqual([]);
    });
});

describe('searxng', () => {
    const config = { provider: 'searxng', baseUrl: 'http://searxng:8080/' };

    it('asks the operator instance for json, and answers with what it found', async () => {
        await initialize(config);
        queueJson({ results: [searxngHit] });

        const results = await plugin.search({ query: 'portishead', limit: 5 });

        expect(results.map(result => result.title)).toEqual(['Portishead']);
        expect(host.calls[0]?.url).toBe('http://searxng:8080/search?q=portishead&format=json');
    });

    it('passes a recency through as a time range', async () => {
        await initialize(config);
        queueJson({ results: [] });

        await plugin.search({ query: 'portishead', limit: 5, recency: 'week' });

        expect(host.calls[0]?.url).toContain('time_range=week');
    });

    it('names the missing json format on the 403 that means it, since the status alone does not', async () => {
        await initialize(config);
        queueJson({ error: 'forbidden' }, 403);

        await expect(plugin.search({ query: 'portishead', limit: 5 })).rejects.toThrow(/json output format/i);
    });
});

describe('brave', () => {
    const config = { provider: 'brave', apiKey: 'a-token' };

    it('sends the subscription token and asks for undecorated snippets', async () => {
        await initialize(config);
        queueJson({ web: { results: [{ title: 'Portishead', description: 'A band.', url: 'https://example.com/p' }] } });

        await plugin.search({ query: 'portishead', limit: 5 });

        expect(host.calls[0]?.headers).toMatchObject({ 'X-Subscription-Token': 'a-token' });
        expect(host.calls[0]?.url).toContain('text_decorations=0');
    });

    it('holds the count inside what the engine will accept, which is below what the form allows', async () => {
        await initialize({ ...config, maxResults: 25 });
        queueJson({ web: { results: [] } });

        await plugin.search({ query: 'portishead', limit: 25 });

        expect(host.calls[0]?.url).toContain('count=20');
    });

    it('points at the key when the engine says the credentials are wrong', async () => {
        await initialize(config);
        queueJson({ error: 'unauthorized' }, 401);

        await expect(plugin.search({ query: 'portishead', limit: 5 })).rejects.toThrow(/subscription token/i);
    });
});

describe('tavily', () => {
    const config = { provider: 'tavily', apiKey: 'a-key' };

    it('posts the query with the answer turned off', async () => {
        await initialize(config);
        queueJson({ results: [{ title: 'Portishead', content: 'A band.', url: 'https://example.com/p' }] });

        await plugin.search({ query: 'portishead', limit: 5 });

        const body = JSON.parse(host.calls[0]?.body ?? '{}');
        expect(host.calls[0]?.method).toBe('POST');
        expect(body).toMatchObject({ query: 'portishead', include_answer: false, topic: 'general' });
    });

    it('asks about news, over a window, when the caller wanted something recent', async () => {
        await initialize(config);
        queueJson({ results: [] });

        await plugin.search({ query: 'portishead', limit: 5, recency: 'week' });

        expect(JSON.parse(host.calls[0]?.body ?? '{}')).toMatchObject({ topic: 'news', days: 7 });
    });
});

describe('bounds', () => {
    it('never asks for more than the operator allowed', async () => {
        await initialize({ provider: 'brave', apiKey: 'a-token', maxResults: 3 });
        queueJson({ web: { results: [] } });

        await plugin.search({ query: 'portishead', limit: 25 });

        expect(host.calls[0]?.url).toContain('count=3');
    });

    it('asks nobody for a blank question', async () => {
        await initialize({ provider: 'searxng', baseUrl: 'http://searxng:8080' });

        await expect(plugin.search({ query: '   ', limit: 5 })).resolves.toEqual([]);
        expect(host.calls).toHaveLength(0);
    });

    it('does not start a request there is not enough of the call left to finish', async () => {
        await initialize({ provider: 'searxng', baseUrl: 'http://searxng:8080' });
        host.seedRemainingMs(REQUEST_TIMEOUT_MS - 1);

        await expect(plugin.search({ query: 'portishead', limit: 5 })).resolves.toEqual([]);
        expect(host.calls).toHaveLength(0);
    });

    it('forgets the credentials when it is unloaded', async () => {
        await initialize({ provider: 'brave', apiKey: 'a-token' });
        await plugin.dispose();

        await expect(plugin.search({ query: 'portishead', limit: 5 })).resolves.toEqual([]);
        expect(host.calls).toHaveLength(0);
    });
});

describe('testConnection', () => {
    it('runs a real query, because every way this fails fails at the query', async () => {
        await initialize({ provider: 'searxng', baseUrl: 'http://searxng:8080' });
        queueJson({ results: [searxngHit] });

        await expect(plugin.testConnection()).resolves.toMatchObject({ ok: true });
        expect(host.calls[0]?.url).toContain('format=json');
    });

    it('reports an engine that answered and found nothing as a failure, which is what it is here', async () => {
        await initialize({ provider: 'searxng', baseUrl: 'http://searxng:8080' });
        queueJson({ results: [] });

        await expect(plugin.testConnection()).resolves.toMatchObject({ ok: false });
    });

    it('reports the refusal rather than throwing it at the operator', async () => {
        await initialize({ provider: 'brave', apiKey: 'wrong' });
        queueJson({ error: 'unauthorized' }, 401);

        const answer = await plugin.testConnection();

        expect(answer.ok).toBe(false);
        expect(answer.message).toMatch(/subscription token/i);
    });
});
