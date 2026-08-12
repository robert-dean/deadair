// The tool exists because a pick that resolves to nothing is dropped silently, so a DJ steered by
// provider search comes back short for reasons nothing in the log connects to the search. What is
// worth testing is therefore the SHAPE of the contract rather than search quality: every answer is
// a record that will survive resolution, bans narrow it, and rotation rules deliberately do not.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import type { TracksRepository } from '../../../src/modules/catalog/tracks.repository.js';
import { LibrarySearchTool } from '../../../src/modules/llm/library.search.tool.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

type Row = { title: string; artistName: string; albumName?: string | null; year?: number | null; genre?: string | null };

function build(rows: Row[] = []) {
    const searchPlayable = vi.fn(async () => rows);
    const tracks = { searchPlayable } as unknown as TracksRepository;
    return { tool: new LibrarySearchTool(tracks, logger), searchPlayable };
}

/** The one tool this source offers, since every test needs it. */
const only = async (tool: LibrarySearchTool) => (await tool.tools())[0]!;

describe('LibrarySearchTool', () => {
    it('offers one tool that says it answers with schedulable records', async () => {
        const { tool } = build();
        const declaration = (await only(tool)).declaration;

        expect(declaration.name).toBe('search_library');
        // The description is the entire basis on which the model chooses between this and
        // `search_catalog`, so it has to name the distinction rather than describe a search.
        expect(declaration.description).toMatch(/library/i);
        expect(declaration.description).toMatch(/cannot be scheduled/i);
    });

    it('answers with the names a model needs and nothing else', async () => {
        const { tool } = build([{ title: 'Windowlicker', artistName: 'Aphex Twin', albumName: 'Windowlicker', year: 1999, genre: 'Electronic' }]);

        const result = (await (await only(tool)).run({ query: 'aphex' })) as { tracks: unknown[] };

        expect(result.tracks).toEqual([{ title: 'Windowlicker', artist: 'Aphex Twin', album: 'Windowlicker', year: 1999, genre: 'Electronic' }]);
    });

    it('leaves out what the catalog does not know rather than sending nulls', async () => {
        // Kysely reads a SQL NULL back as undefined here, and either way a model shown
        // `"album": null` spends context on a field that says nothing.
        const { tool } = build([{ title: 'A', artistName: 'One', albumName: null, year: null, genre: null }]);

        const result = (await (await only(tool)).run({ query: 'a' })) as { tracks: Record<string, unknown>[] };

        expect(result.tracks[0]).toEqual({ title: 'A', artist: 'One' });
    });

    it('caps the limit rather than honouring a request for the whole library', async () => {
        const { tool, searchPlayable } = build();

        await (await only(tool)).run({ query: 'a', limit: 400 });

        expect(searchPlayable).toHaveBeenCalledWith('a', 25);
    });

    it('takes a smaller limit at its word', async () => {
        const { tool, searchPlayable } = build();

        await (await only(tool)).run({ query: 'a', limit: 5 });

        expect(searchPlayable).toHaveBeenCalledWith('a', 5);
    });

    it('falls back to the ceiling for a nonsense limit rather than failing the search', async () => {
        // The query is the part worth failing over; a bad limit is not.
        const { tool, searchPlayable } = build();

        await (await only(tool)).run({ query: 'a', limit: 'lots' as unknown as number });

        expect(searchPlayable).toHaveBeenCalledWith('a', 25);
    });

    it('reports a missing query as something the model can correct', async () => {
        // ToolRegistry turns a throw into a result the model reads, so this is a sentence to it
        // rather than an exception at the loop.
        const { tool } = build();

        await expect((await only(tool)).run({})).rejects.toThrow(/query/);
    });

    it('reports a whitespace query the same way', async () => {
        const { tool } = build();

        await expect((await only(tool)).run({ query: '   ' })).rejects.toThrow(/query/);
    });

    it('trims the query before searching', async () => {
        const { tool, searchPlayable } = build();

        await (await only(tool)).run({ query: '  aphex  ' });

        expect(searchPlayable).toHaveBeenCalledWith('aphex', 25);
    });

    it('answers with nothing rather than failing when the library has no match', async () => {
        // A thin library is a fact about the library. The generator above this counts a run with
        // no tool calls at all as a model failure, and this is deliberately not that.
        const { tool } = build([]);

        expect(await (await only(tool)).run({ query: 'nothing' })).toEqual({ tracks: [] });
    });
});
