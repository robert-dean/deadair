// The tool exists because a pick that resolves to nothing is dropped silently, so a DJ steered by
// provider search comes back short for reasons nothing in the log connects to the search. What is
// worth testing is therefore the SHAPE of the contract rather than search quality: every answer is
// a record that will survive resolution, bans narrow it, and rotation rules deliberately do not.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { TracksRepository } from '../../../src/modules/catalog/tracks.repository.js';
import { ADVISORY_KEY } from '../../../src/modules/director/advisory.policy.js';
import { LibrarySearchTool } from '../../../src/modules/llm/library.search.tool.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

type Row = { title: string; artistName: string; albumName?: string | null; year?: number | null; genre?: string | null };

function build(rows: Row[] = [], settings: Record<string, unknown> = {}) {
    const searchPlayable = vi.fn(async () => rows);
    const tracks = { searchPlayable } as unknown as TracksRepository;
    const config = {
        get: (key: string, fallback?: unknown) => (key in settings ? settings[key] : fallback),
    } as unknown as AppConfig;
    return { tool: new LibrarySearchTool(tracks, config, logger), searchPlayable };
}

/** The one tool this source offers, since every test needs it. */
const only = async (tool: LibrarySearchTool) => (await tool.tools())[0]!;

describe('LibrarySearchTool', () => {
    it('offers one tool that says to look here first, and where to look next', async () => {
        const { tool } = build();
        const declaration = (await only(tool)).declaration;

        expect(declaration.name).toBe('search_library');
        // The description is the entire basis on which the model chooses between this and
        // `search_catalog`. Both answer with records that can air now, so what it has to carry is
        // the ORDER — look here first, reach past it when this cannot fill the ask — rather than
        // the old claim that anything else was unschedulable.
        expect(declaration.description).toMatch(/already owns/i);
        expect(declaration.description).toMatch(/search_catalog/);
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

        expect(searchPlayable).toHaveBeenCalledWith('a', 25, false);
    });

    it('takes a smaller limit at its word', async () => {
        const { tool, searchPlayable } = build();

        await (await only(tool)).run({ query: 'a', limit: 5 });

        expect(searchPlayable).toHaveBeenCalledWith('a', 5, false);
    });

    it('falls back to the ceiling for a nonsense limit rather than failing the search', async () => {
        // The query is the part worth failing over; a bad limit is not.
        const { tool, searchPlayable } = build();

        await (await only(tool)).run({ query: 'a', limit: 'lots' as unknown as number });

        expect(searchPlayable).toHaveBeenCalledWith('a', 25, false);
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

        expect(searchPlayable).toHaveBeenCalledWith('aphex', 25, false);
    });

    it('answers with nothing rather than failing when the library has no match', async () => {
        // A thin library is a fact about the library. The generator above this counts a run with
        // no tool calls at all as a model failure, and this is deliberately not that.
        const { tool } = build([]);

        const result = (await (await only(tool)).run({ query: 'nothing' })) as { tracks: unknown[] };

        expect(result.tracks).toEqual([]);
    });

    it('sends an empty answer somewhere to look next, because the empty result alone is what cost a refill', async () => {
        // `{"tracks":[]}` is true and useless: it says the station does not own the record and
        // nothing about the tool that can reach it.
        const { tool } = build([]);

        const result = (await (await only(tool)).run({ query: 'Miami Nights 1984' })) as { note?: string };

        expect(result.note).toMatch(/search_catalog/);
        // The reason the model is allowed to reach past a tool it was told to prefer.
        expect(result.note).toMatch(/safe to name/i);
        expect(result.note).toContain('Miami Nights 1984');
    });

    it('withdraws the library once it has come back empty twice in a row', async () => {
        // The measured failure: a model working through a similarity list one artist at a time,
        // asking the library for each, and running out of tool steps before it answered. A stronger
        // PREFERENCE would change nothing there, since preferring the library is what it was doing.
        const { tool } = build([]);
        const search = (await only(tool)).run;

        const first = (await search({ query: 'Lazerhawk' })) as { note?: string };
        const second = (await search({ query: 'Lost Years' })) as { note?: string };

        expect(first.note).not.toMatch(/2 times in a row/);
        expect(second.note).toMatch(/2 times in a row/);
        expect(second.note).toMatch(/does not hold this kind of music/);
    });

    it('starts the run again after a search that found something', async () => {
        // A library that answered once is not one to give up on. What is being counted is a run of
        // misses rather than a tally of them.
        const rows: Row[] = [];
        const { tool } = build(rows);
        const search = (await only(tool)).run;

        await search({ query: 'Lazerhawk' });
        rows.push({ title: 'Enter Sandman', artistName: 'Metallica' });
        await search({ query: 'metallica' });
        rows.length = 0;
        const afterHit = (await search({ query: 'Betamaxx' })) as { note?: string };

        expect(afterHit.note).not.toMatch(/in a row/);
    });

    it('narrows to clean copies when the station may play nothing else', async () => {
        // Same side of the line as the bans: a record that cannot air must not be offered, because
        // the model will name it and the resolver will drop it.
        const { tool, searchPlayable } = build([], { [ADVISORY_KEY]: 'clean-only' });

        await (await only(tool)).run({ query: 'a' });

        expect(searchPlayable).toHaveBeenCalledWith('a', 25, true);
    });

    it('does not narrow for a mere preference, which is settled when the copy is chosen', async () => {
        // The rotation-rules side of the line. The work is playable either way, so pre-filtering
        // would return a worse pool for a preference `bindingsFor` is going to honour anyway.
        const { tool, searchPlayable } = build([], { [ADVISORY_KEY]: 'prefer-clean' });

        await (await only(tool)).run({ query: 'a' });

        expect(searchPlayable).toHaveBeenCalledWith('a', 25, false);
    });
});
