// The tool reports an opinion and never enforces one, so what is worth testing is the shape of
// that contract: the description has to say the dislikes are enforced elsewhere (a model that
// thinks this IS the filter reads an empty answer as permission), the ceiling has to be enforced
// rather than honoured, and a station nobody has rated anything on has to be an ordinary answer
// rather than a failure.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import type { StationTaste, TasteRepository } from '../../../src/modules/catalog/taste.repository.js';
import { StationTasteTool } from '../../../src/modules/llm/station.taste.tool.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const nothing = <T,>(): { shown: T[]; total: number } => ({ shown: [], total: 0 });

const empty = (): StationTaste => ({
    likedArtists: nothing(),
    dislikedArtists: nothing(),
    likedAlbums: nothing(),
    dislikedAlbums: nothing(),
    likedTracks: nothing(),
    dislikedTracks: nothing(),
});

function build(answer: Partial<StationTaste> = {}) {
    const read = vi.fn(async (): Promise<StationTaste> => ({ ...empty(), ...answer }));
    const taste = { taste: read } as unknown as TasteRepository;
    return { tool: new StationTasteTool(taste, logger), read };
}

const only = async (tool: StationTasteTool) => (await tool.tools())[0]!;

describe('StationTasteTool', () => {
    it('offers one tool that says the dislikes are enforced without it', async () => {
        const { tool } = build();
        const declaration = (await only(tool)).declaration;

        expect(declaration.name).toBe('station_taste');
        expect(declaration.description).toMatch(/dropped even if you choose it/i);
    });

    it('answers with both sides and how much of each there is', async () => {
        const { tool } = build({ likedArtists: { shown: [{ name: 'Sleep' }], total: 40 } });

        const result = (await (await only(tool)).run({})) as StationTaste;

        expect(result.likedArtists.shown).toEqual([{ name: 'Sleep' }]);
        // The total is what says a list is a sample. Without it a station with forty liked artists
        // and one showing a single row look the same to a model.
        expect(result.likedArtists.total).toBe(40);
    });

    it('enforces its ceiling rather than honouring what was asked for', async () => {
        const { tool, read } = build();

        await (await only(tool)).run({ limit: 5_000 });

        expect(read.mock.calls[0]![0]).toBe(60);
    });

    it('falls back to the ceiling on a nonsense limit rather than erroring', async () => {
        // The query is the part worth failing over, and there is no query here at all.
        const { tool, read } = build();

        await (await only(tool)).run({ limit: 'lots' });

        expect(read.mock.calls[0]![0]).toBe(60);
    });

    it('answers with empty lists for a station nobody has said anything about', async () => {
        const { tool } = build();

        const result = (await (await only(tool)).run({})) as StationTaste;

        expect(result.dislikedArtists).toEqual({ shown: [], total: 0 });
    });
});
