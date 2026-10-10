// The route preview as the console reads it: the planner's stops flattened onto the wire, and a count of
// how many hops rest on a fact against how many rest on an opinion.

import { describe, expect, it, vi } from 'vitest';

import { RouteService } from '../../../src/modules/director/route.service.js';
import type { RouteRepository } from '../../../src/modules/director/route.repository.js';
import type { SimilarityService } from '../../../src/modules/similarity/similarity.service.js';

const owned = (...names: string[]) => new Map(names.map(name => [name.toLowerCase(), { artistKey: name.toLowerCase(), name }]));

function build() {
    const routes = {
        ownedArtists: vi.fn(
            async (keys: readonly string[]) => new Map([...owned('Gorillaz', 'Blur', 'Daft Punk')].filter(([key]) => keys.includes(key))),
        ),
        coCredits: vi.fn(async (key: string) =>
            key === 'gorillaz' ? [{ artistKey: 'blur', name: 'Blur', title: 'A Shared One', lead: 'Gorillaz' }] : [],
        ),
    } as unknown as RouteRepository;
    const similarity = {
        similarTo: vi.fn(async ({ name }: { name: string }) =>
            name === 'Blur' ? [{ name: 'Daft Punk', source: 'deadair.lastfm', match: 0.5 }] : [],
        ),
    } as unknown as SimilarityService;
    return new RouteService(routes, similarity);
}

describe('RouteService.preview', () => {
    it('says how each stop connects, and how many hops are facts against opinions', async () => {
        expect(await build().preview({ from: 'Gorillaz', to: 'Daft Punk' })).toEqual({
            found: true,
            stops: [
                { artist: 'Gorillaz' },
                { artist: 'Blur', link: 'credit', sharedTitle: 'A Shared One', sharedLead: 'Gorillaz' },
                { artist: 'Daft Punk', link: 'similar', source: 'deadair.lastfm' },
            ],
            factual: 1,
            similar: 1,
        });
    });

    it('says plainly when there is no route', async () => {
        expect(await build().preview({ from: 'Gorillaz', to: 'Nobody' })).toEqual({ found: false, stops: [], factual: 0, similar: 0 });
    });
});
