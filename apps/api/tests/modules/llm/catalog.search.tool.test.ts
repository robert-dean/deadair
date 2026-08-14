// Why this tool matters more than it looks: every writer inherits the rule that a break names ONLY
// records the station can play. Without a way to check, the only way to honour that is to hand the
// model a list up front and hope it is the right one. So the behaviour under test is mostly about
// being honest when it cannot answer, rather than about search quality.

import { describe, expect, it, vi } from 'vitest';
import type { ProviderTrack } from '@deadair/plugin-sdk';

import type { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import type { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { CatalogSearchTool } from '../../../src/modules/llm/catalog.search.tool.js';

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as never;

const passthroughInvoker = () =>
    ({ invoke: vi.fn(async (_id: string, _op: string, work: () => Promise<unknown>) => work()) }) as unknown as PluginInvoker;

const track = (title: string, artist: string, album?: string): ProviderTrack => ({
    id: `${title}-${artist}`,
    title,
    artists: [artist],
    ...(album === undefined ? {} : { album }),
});

interface FakeCatalogOptions {
    id?: string;
    tracks?: ProviderTrack[];
    /** Omit `searchTracks` entirely, as a browse-only provider does. */
    searches?: boolean;
    fails?: boolean;
}

function fakeCatalog(options: FakeCatalogOptions = {}): PluginRecord {
    const instance: Record<string, unknown> = {
        listPlaylists: async () => [],
        getPlaylistTracks: async () => [],
    };

    if (options.searches !== false) {
        instance.searchTracks = vi.fn(async () => {
            if (options.fails === true) throw new Error('the provider was down');
            return options.tracks ?? [];
        });
    }

    return {
        id: options.id ?? 'deadair.provider',
        dir: '/plugins/provider',
        status: 'active',
        manifest: { capabilities: ['catalog'] },
        instance,
    } as unknown as PluginRecord;
}

const toolFor = (records: PluginRecord[]) =>
    new CatalogSearchTool({ list: () => records } as unknown as PluginRegistry, passthroughInvoker(), logger());

/** The tool's single declaration and its runner, or undefined when it offered nothing. */
async function offered(records: PluginRecord[]) {
    const tools = await toolFor(records).tools();
    return tools[0];
}

describe('what it offers', () => {
    it('offers nothing when no provider is installed', async () => {
        // A declaration whose every call answers "no providers" spends context teaching the model
        // about a tool that cannot help it.
        expect(await offered([])).toBeUndefined();
    });

    it('offers nothing when the only provider cannot be searched', async () => {
        // Every catalog method is optional in the SDK, so a browse-only provider is legitimate.
        // Calling the method anyway would be a TypeError with the model waiting on it.
        expect(await offered([fakeCatalog({ searches: false })])).toBeUndefined();
    });

    it('offers a search when a provider can be searched', async () => {
        const tool = await offered([fakeCatalog()]);

        expect(tool?.declaration.name).toBe('search_catalog');
        expect(tool?.declaration.parameters).toMatchObject({ required: ['query'] });
    });

    it('says it reaches past what the station owns, and that those records can still be played', async () => {
        // The description is the entire basis on which a model decides to call this. It used to
        // claim these results were "music the station can actually play", which was false until the
        // resolver could look a record up and ingest it; now it is true, and the text has to say
        // both halves — this reaches further, and choosing from it costs a fetch.
        const tool = await offered([fakeCatalog()]);

        expect(tool?.declaration.description).toContain('does not own yet');
        expect(tool?.declaration.description).toContain('safe to name');
        expect(tool?.declaration.description).toContain('search_library');
    });
});

describe('searching', () => {
    it('answers with what a provider found', async () => {
        const tool = await offered([fakeCatalog({ tracks: [track('Roygbiv', 'Boards of Canada', 'Music Has the Right')] })]);

        const result = (await tool!.run({ query: 'boc' })) as { tracks: unknown[]; searched: number };

        expect(result.tracks).toEqual([{ title: 'Roygbiv', artist: 'Boards of Canada', album: 'Music Has the Right', source: 'deadair.provider' }]);
        expect(result.searched).toBe(1);
    });

    it('merges across every provider that can be searched', async () => {
        const tool = await offered([
            fakeCatalog({ id: 'a', tracks: [track('One', 'Artist A')] }),
            fakeCatalog({ id: 'b', tracks: [track('Two', 'Artist B')] }),
        ]);

        const result = (await tool!.run({ query: 'x' })) as { tracks: { title: string }[]; searched: number };

        expect(result.tracks.map(item => item.title)).toEqual(['One', 'Two']);
        expect(result.searched).toBe(2);
    });

    it('treats the same record from two providers as one', async () => {
        const tool = await offered([
            fakeCatalog({ id: 'a', tracks: [track('Roygbiv', 'Boards of Canada')] }),
            fakeCatalog({ id: 'b', tracks: [track('roygbiv', 'boards of canada')] }),
        ]);

        const result = (await tool!.run({ query: 'x' })) as { tracks: unknown[] };

        expect(result.tracks).toHaveLength(1);
    });

    it('skips a provider that failed rather than failing the search', async () => {
        // A partial answer is worth more to a DJ than none.
        const tool = await offered([fakeCatalog({ id: 'broken', fails: true }), fakeCatalog({ id: 'ok', tracks: [track('One', 'A')] })]);

        const result = (await tool!.run({ query: 'x' })) as { tracks: { title: string }[] };

        expect(result.tracks.map(item => item.title)).toEqual(['One']);
    });

    it('caps the answer however many were asked for', async () => {
        const many = Array.from({ length: 40 }, (_, index) => track(`Track ${index}`, `Artist ${index}`));
        const tool = await offered([fakeCatalog({ tracks: many })]);

        const result = (await tool!.run({ query: 'x', limit: 500 })) as { tracks: unknown[] };

        expect(result.tracks.length).toBeLessThanOrEqual(25);
    });

    it('offers enough records to programme an oversampled refill from', async () => {
        // Not a round number for its own sake. `ModelSetGenerator` asks for an oversampled batch —
        // two dozen records for a fifteen-item refill — and a model shown ten cannot name two dozen
        // distinct ones. It padded the answer with repeats instead, and the deterministic floor,
        // which cannot act on a brief, filled half a briefed hour.
        const many = Array.from({ length: 40 }, (_, index) => track(`Track ${index}`, `Artist ${index}`));
        const tool = await offered([fakeCatalog({ tracks: many })]);

        const result = (await tool!.run({ query: 'x' })) as { tracks: unknown[] };

        expect(result.tracks.length).toBeGreaterThanOrEqual(24);
    });

    it('honours a smaller limit the model asked for', async () => {
        const many = Array.from({ length: 10 }, (_, index) => track(`Track ${index}`, 'Artist'));
        const tool = await offered([fakeCatalog({ tracks: many })]);

        const result = (await tool!.run({ query: 'x', limit: 3 })) as { tracks: unknown[] };

        expect(result.tracks).toHaveLength(3);
    });

    it('answers with the LEAD artist, so a collaboration can be looked up again', async () => {
        // The bug this file did not catch for as long as the tool existed. `artists.join(', ')`
        // reads perfectly well and is unschedulable: the model is told to copy the artist back
        // exactly, and both steps that then judge the pick match on the lead artist alone —
        // `songKey(title, [artist])` in `PickResolver.identify`, and `normalizeKey(artists[0])` in
        // `ProviderTrackLookup`. Neither can equal a joined line. In a live run every solo credit
        // resolved and every collaboration was dropped as "not in the catalog".
        const duet: ProviderTrack = { id: 'x', title: 'Jazz Club', artists: ['Accelio', 'ROOXG'] };
        const tool = await offered([fakeCatalog({ tracks: [duet] })]);

        const result = (await tool!.run({ query: 'jazz' })) as { tracks: { artist: string; featuring?: string[] }[] };

        expect(result.tracks[0]?.artist).toBe('Accelio');
        // Shown, so the listing stays honest about what the record is, and separate so it cannot get
        // back into the field that has to survive a strict match.
        expect(result.tracks[0]?.featuring).toEqual(['ROOXG']);
    });

    it('leaves out a record with nobody credited', async () => {
        // Unnameable: `readPicks` drops a pick with a blank artist and the lookup refuses to search
        // for one, so offering it can only spend context on a row the model is penalised for using.
        const anonymous: ProviderTrack = { id: 'x', title: 'Untitled', artists: [] };
        const tool = await offered([fakeCatalog({ tracks: [anonymous, track('One', 'A')] })]);

        const result = (await tool!.run({ query: 'x' })) as { tracks: { title: string }[] };

        expect(result.tracks.map(item => item.title)).toEqual(['One']);
    });

    it('refuses a query it cannot read, in terms the model can correct', async () => {
        // Arguments arrive as the model produced them, so nothing here trusts a type. "I could not
        // read your query" is something it can fix; an exception is not.
        const tool = await offered([fakeCatalog()]);

        await expect(tool!.run({})).rejects.toThrow('query');
        await expect(tool!.run({ query: 42 })).rejects.toThrow('query');
        await expect(tool!.run({ query: '  ' })).rejects.toThrow('query');
    });

    it('survives a limit that is not a number', async () => {
        const tool = await offered([fakeCatalog({ tracks: [track('One', 'A')] })]);

        const result = (await tool!.run({ query: 'x', limit: 'lots' })) as { tracks: unknown[] };

        expect(result.tracks).toHaveLength(1);
    });
});
