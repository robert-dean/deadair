// Asking the open web: every installed search plugin asked the same question,
// their answers combined and de-duplicated by URL, a failing engine costing its
// own results and nothing else, and the same question inside the window asked
// once. No HTTP here — `SearchService` takes words and answers with results,
// which is the same path the tool drives.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import { PluginError, type PluginManifest, type SearchResult } from '@deadair/plugin-sdk';

import { MAX_SEARCH_RESULTS, SearchService, SEARCH_TTL_MS } from '../../../src/modules/search/search.service.js';
import { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

const ALPHA = 'deadair.alpha';
const BETA = 'deadair.beta';

const stubLogger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

function manifest(id: string, overrides: Partial<PluginManifest> = {}): PluginManifest {
    return {
        id,
        name: id,
        version: '1.0.0',
        capabilities: ['search'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
        ...overrides,
    };
}

const hit = (title: string, url: string): SearchResult => ({ title, snippet: `about ${title}`, url });

function record(id: string, search: unknown, overrides: Partial<PluginRecord> = {}): PluginRecord {
    return {
        id,
        dir: `/plugins/${id}`,
        status: 'active',
        manifest: manifest(id),
        instance: { init: vi.fn(), search } as never,
        ...overrides,
    };
}

const build = (records: PluginRecord[]): SearchService => {
    const registry = new PluginRegistry();
    registry.setAll(records);
    return new SearchService(registry, new PluginInvoker(registry, stubPluginLog().log), stubLogger());
};

/**
 * The cache is static on the class, which is the whole point of it (the service
 * is scoped), so a test that did not clear it would inherit the previous one's
 * answers.
 */
const clearCache = (): void => (SearchService as unknown as { cache: Map<string, unknown> }).cache.clear();

beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    clearCache();
});

describe('SearchService', () => {
    it('answers with nothing, and asks nobody, when no search plugin is installed', async () => {
        const service = build([]);

        expect(service.hasSearch()).toBe(false);
        await expect(service.search('a question', 5)).resolves.toEqual([]);
    });

    it('does not count a plugin that declares search and never wrote the method', async () => {
        const service = build([record(ALPHA, undefined)]);

        expect(service.hasSearch()).toBe(false);
    });

    it('does not count a plugin that is not active', async () => {
        const service = build([record(ALPHA, vi.fn(), { status: 'disabled' })]);

        expect(service.hasSearch()).toBe(false);
    });

    it('answers with what the engine found, in the engine order', async () => {
        const search = vi.fn(async () => [hit('First', 'https://example.com/a'), hit('Second', 'https://example.com/b')]);
        const service = build([record(ALPHA, search)]);

        const results = await service.search('portishead', 5);

        expect(results.map(result => result.title)).toEqual(['First', 'Second']);
    });

    it('asks nobody for a blank question', async () => {
        const search = vi.fn(async () => [hit('First', 'https://example.com/a')]);
        const service = build([record(ALPHA, search)]);

        await expect(service.search('   ', 5)).resolves.toEqual([]);
        expect(search).not.toHaveBeenCalled();
    });

    it('passes the recency and the language through to the engine', async () => {
        const search = vi.fn(async () => []);
        const service = build([record(ALPHA, search)]);

        await service.search('portishead', 5, { recency: 'week', language: 'en' });

        expect(search).toHaveBeenCalledWith({ query: 'portishead', limit: MAX_SEARCH_RESULTS, recency: 'week', language: 'en' });
    });

    it('asks every engine for the ceiling, whatever this caller wanted', async () => {
        const search = vi.fn(async () => []);
        const service = build([record(ALPHA, search)]);

        await service.search('portishead', 2);

        expect(search).toHaveBeenCalledWith({ query: 'portishead', limit: MAX_SEARCH_RESULTS });
    });

    it('trims to what the caller asked for', async () => {
        const search = vi.fn(async () => [hit('First', 'https://example.com/a'), hit('Second', 'https://example.com/b')]);
        const service = build([record(ALPHA, search)]);

        await expect(service.search('portishead', 1)).resolves.toHaveLength(1);
    });

    it('combines two engines and keeps one copy of a page they both found', async () => {
        const first = vi.fn(async () => [hit('Shared', 'https://example.com/story'), hit('Only mine', 'https://example.com/a')]);
        // Same page, spelt differently: a trailing slash, a different case in the
        // host, and http rather than https are all the same address.
        const second = vi.fn(async () => [hit('Shared again', 'http://EXAMPLE.com/story/'), hit('Only theirs', 'https://example.com/b')]);
        const service = build([record(ALPHA, first), record(BETA, second)]);

        const results = await service.search('portishead', 10);

        expect(results.map(result => result.title)).toEqual(['Shared', 'Only mine', 'Only theirs']);
    });

    it('keeps two pages that differ only in their query string', async () => {
        const search = vi.fn(async () => [hit('One', 'https://example.com/read?id=1'), hit('Two', 'https://example.com/read?id=2')]);
        const service = build([record(ALPHA, search)]);

        await expect(service.search('portishead', 10)).resolves.toHaveLength(2);
    });

    it('drops a result with no title and one with no url, since neither can be read or cited', async () => {
        const search = vi.fn(async () => [
            { title: '  ', snippet: 'nothing to read', url: 'https://example.com/a' },
            { title: 'No address', snippet: 'nowhere to check', url: '' },
            hit('Real', 'https://example.com/c'),
        ]);
        const service = build([record(ALPHA, search)]);

        const results = await service.search('portishead', 10);

        expect(results.map(result => result.title)).toEqual(['Real']);
    });

    it('lets one engine fail without costing the other its results', async () => {
        const failing = vi.fn(async () => {
            throw new PluginError('rate limited').withCode('unavailable');
        });
        const working = vi.fn(async () => [hit('Still here', 'https://example.com/a')]);
        const service = build([record(ALPHA, failing), record(BETA, working)]);

        const results = await service.search('portishead', 10);

        expect(results.map(result => result.title)).toEqual(['Still here']);
    });

    it('answers with nothing when the only engine fails', async () => {
        const failing = vi.fn(async () => {
            throw new Error('boom');
        });
        const service = build([record(ALPHA, failing)]);

        await expect(service.search('portishead', 10)).resolves.toEqual([]);
    });

    it('asks the same question once inside the window', async () => {
        const search = vi.fn(async () => [hit('First', 'https://example.com/a')]);
        const service = build([record(ALPHA, search)]);

        await service.search('portishead', 5);
        await service.search('  PORTISHEAD  ', 5);

        expect(search).toHaveBeenCalledTimes(1);
    });

    it('caches an empty answer too, since nothing matched will not change inside the window', async () => {
        const search = vi.fn(async () => []);
        const service = build([record(ALPHA, search)]);

        await service.search('portishead', 5);
        await service.search('portishead', 5);

        expect(search).toHaveBeenCalledTimes(1);
    });

    it('treats a different recency as a different question', async () => {
        const search = vi.fn(async () => []);
        const service = build([record(ALPHA, search)]);

        await service.search('portishead', 5);
        await service.search('portishead', 5, { recency: 'week' });

        expect(search).toHaveBeenCalledTimes(2);
    });

    it('asks again once the window has passed', async () => {
        vi.useFakeTimers();
        const search = vi.fn(async () => [hit('First', 'https://example.com/a')]);
        const service = build([record(ALPHA, search)]);

        await service.search('portishead', 5);
        vi.advanceTimersByTime(SEARCH_TTL_MS + 1);
        await service.search('portishead', 5);

        expect(search).toHaveBeenCalledTimes(2);
    });

    it('shares its memory across instances, because the service is scoped and the answer is not', async () => {
        const search = vi.fn(async () => [hit('First', 'https://example.com/a')]);
        const records = [record(ALPHA, search)];

        await build(records).search('portishead', 5);
        await build(records).search('portishead', 5);

        expect(search).toHaveBeenCalledTimes(1);
    });
});
