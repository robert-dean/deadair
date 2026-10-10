// What a provider search hands back is the record AND the provider's own id for it, so a caller can
// take that exact copy in rather than search for it again by name. Tested here because the id is the
// one field nothing downstream can recover once it is dropped.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { ProviderTrack } from '@deadair/plugin-sdk';

import { ProviderSearch } from '../../../src/modules/llm/provider.search.js';
import type { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

function build(tracks: ProviderTrack[]) {
    const instance = { listPlaylists: vi.fn(), getPlaylistTracks: vi.fn(), searchTracks: vi.fn(async () => tracks) };
    const record = { id: 'deadair.spotify', status: 'active', manifest: { capabilities: ['catalog'] }, instance };
    const registry = { list: vi.fn(() => [record]) } as unknown as PluginRegistry;
    const invoke = vi.fn(async (_id: string, _op: string, call: () => Promise<unknown>, _options?: { signal?: AbortSignal }) => call());
    return { search: new ProviderSearch(registry, { invoke } as unknown as PluginInvoker, logger), invoke };
}

describe('ProviderSearch', () => {
    it("carries the provider's id, the length and the year with each record", async () => {
        const { search } = build([{ id: 'sp-1', title: 'Blueberry Hill', artists: ['Fats Domino'], durationMs: 142_000, year: 1956 }]);

        const { tracks } = await search.search('blueberry', {}, 10);

        expect(tracks).toEqual([
            { title: 'Blueberry Hill', artist: 'Fats Domino', source: 'deadair.spotify', externalId: 'sp-1', durationMs: 142_000, year: 1956 },
        ]);
    });

    it('leaves a length or a year the provider did not give off, rather than undefined', async () => {
        const { search } = build([{ id: 'sp-2', title: 'Song', artists: ['Band'] }]);

        const { tracks } = await search.search('song', {}, 10);

        expect(tracks[0]).not.toHaveProperty('durationMs');
        expect(tracks[0]).not.toHaveProperty('year');
    });

    it("names the caller in the invoker's log, and the presenter's tool when nobody says", async () => {
        const { search, invoke } = build([]);

        await search.search('a', {}, 10);
        await search.search('a', {}, 10, { operation: 'requests.search.searchTracks' });

        expect(invoke.mock.calls.map(call => call[1])).toEqual(['llm.tool.searchTracks', 'requests.search.searchTracks']);
    });

    it("hands the caller's signal to each invocation", async () => {
        const { search, invoke } = build([]);
        const controller = new AbortController();

        await search.search('a', {}, 10, { signal: controller.signal });

        expect(invoke.mock.calls[0]?.[3]).toEqual({ signal: controller.signal });
    });

    it('asks no further provider once the signal has fired', async () => {
        // The providers are asked one at a time. A conversation taken back during the first must not
        // sit through every other provider's search with nobody left to read the answer.
        const controller = new AbortController();
        const plugin = (id: string) => ({
            id,
            status: 'active',
            manifest: { capabilities: ['catalog'] },
            instance: { listPlaylists: vi.fn(), getPlaylistTracks: vi.fn(), searchTracks: vi.fn(async () => []) },
        });
        const first = plugin('deadair.navidrome');
        const second = plugin('deadair.spotify');
        const registry = { list: vi.fn(() => [first, second]) } as unknown as PluginRegistry;
        const invoke = vi.fn(async (_id: string, _op: string, call: () => Promise<unknown>, _options?: { signal?: AbortSignal }) => {
            const answer = await call();
            controller.abort();
            return answer;
        });
        const search = new ProviderSearch(registry, { invoke } as unknown as PluginInvoker, logger);

        await search.search('a', {}, 10, { signal: controller.signal });

        expect(first.instance.searchTracks).toHaveBeenCalled();
        expect(second.instance.searchTracks).not.toHaveBeenCalled();
    });
});
