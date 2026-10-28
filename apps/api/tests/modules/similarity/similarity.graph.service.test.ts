// What is pinned here is the walk over the store and the shape answered, against a store double
// holding a small directed graph. The SQL each read compiles to is pinned beside the repository.

import { describe, expect, it } from 'vitest';

import { SimilarityGraphService } from '../../../src/modules/similarity/similarity.graph.service.js';
import type { CatalogArtistKey, SimilarityStoreRepository, StoredEdge } from '../../../src/modules/similarity/similarity.store.repository.js';

const SLAYER = '00000000-0000-4000-8000-000000000001';
const KREATOR = '00000000-0000-4000-8000-000000000002';

function edge(from: string, to: string, rank: number, match?: number): StoredEdge {
    const name = (key: string) => key[0]!.toUpperCase() + key.slice(1);
    return { from, fromName: name(from), to, toName: name(to), rank, source: 'deadair.lastfm', ...(match === undefined ? {} : { match }) };
}

/** A store over `edges`, answering the way the SQL does: touching either end, library on both, best rank first, then the limit. */
function storeOf(edges: StoredEdge[], catalog: CatalogArtistKey[]) {
    const inCatalog = (key: string) => catalog.some(artist => artist.artistKey === key);
    const reads: { touching?: readonly string[]; library: boolean; limit: number }[] = [];
    const store = {
        edges: async (options: { touching?: readonly string[]; library: boolean; limit: number }) => {
            reads.push(options);
            return edges
                .filter(e => options.touching === undefined || options.touching.includes(e.from) || options.touching.includes(e.to))
                .filter(e => !options.library || (inCatalog(e.from) && inCatalog(e.to)))
                .sort((a, b) => a.rank - b.rank || a.from.localeCompare(b.from))
                .slice(0, options.limit);
        },
        catalogArtists: async (keys: readonly string[]) => catalog.filter(artist => keys.includes(artist.artistKey)),
        catalogArtist: async (id: string) => catalog.find(artist => artist.id === id),
    };
    return { service: new SimilarityGraphService(store as unknown as SimilarityStoreRepository), reads };
}

const CATALOG: CatalogArtistKey[] = [
    { id: SLAYER, name: 'Slayer', artistKey: 'slayer' },
    { id: KREATOR, name: 'KREATOR', artistKey: 'kreator' },
];

// slayer -> megadeth, kreator; kreator -> slayer, sodom; sodom -> destruction
const EDGES = [
    edge('slayer', 'megadeth', 0, 0.9),
    edge('slayer', 'kreator', 1),
    edge('kreator', 'slayer', 0),
    edge('kreator', 'sodom', 1),
    edge('sodom', 'destruction', 0),
];

describe('SimilarityGraphService', () => {
    it('answers the whole store, naming each node once and joining the catalog by key', async () => {
        const { service } = storeOf(EDGES, CATALOG);

        const graph = await service.getGraph({ depth: 1, library: false, limit: 500 });

        expect(graph.truncated).toBe(false);
        expect(graph.edges).toHaveLength(5);
        expect(graph.edges[0]).toEqual({ from: 'kreator', to: 'slayer', rank: 0, source: 'deadair.lastfm' });
        expect(graph.nodes).toHaveLength(5);
        // The catalog's spelling wins over the source's, and only a catalog artist carries an id.
        expect(graph.nodes.find(node => node.key === 'kreator')).toEqual({ key: 'kreator', name: 'KREATOR', artistId: KREATOR });
        expect(graph.nodes.find(node => node.key === 'megadeth')).toEqual({ key: 'megadeth', name: 'Megadeth' });
    });

    it('keeps both directions of a pair as two edges', async () => {
        const { service } = storeOf(EDGES, CATALOG);

        const graph = await service.getGraph({ depth: 1, library: false, limit: 500 });

        const between = graph.edges.filter(e => [e.from, e.to].sort().join() === 'kreator,slayer');
        expect(between.map(e => `${e.from}>${e.to}`).sort()).toEqual(['kreator>slayer', 'slayer>kreator']);
    });

    it('says when the limit cut the answer', async () => {
        const { service, reads } = storeOf(EDGES, CATALOG);

        const graph = await service.getGraph({ depth: 1, library: false, limit: 2 });

        expect(graph.truncated).toBe(true);
        expect(graph.edges).toHaveLength(2);
        expect(reads[0]?.limit).toBe(3);
    });

    it('draws one step around an artist, following edges into it as well as out of it', async () => {
        const { service } = storeOf(EDGES, CATALOG);

        const graph = await service.getGraph({ around: KREATOR, depth: 1, library: false, limit: 500 });

        expect(graph.edges.map(e => `${e.from}>${e.to}`).sort()).toEqual(['kreator>slayer', 'kreator>sodom', 'slayer>kreator']);
        expect(graph.nodes.map(node => node.key).sort()).toEqual(['kreator', 'slayer', 'sodom']);
        expect(graph.truncated).toBe(false);
    });

    it('takes a second step from every artist the first one reached', async () => {
        const { service } = storeOf(EDGES, CATALOG);

        const graph = await service.getGraph({ around: KREATOR, depth: 2, library: false, limit: 500 });

        expect(graph.edges.map(e => `${e.from}>${e.to}`).sort()).toEqual([
            'kreator>slayer',
            'kreator>sodom',
            'slayer>kreator',
            'slayer>megadeth',
            'sodom>destruction',
        ]);
    });

    it('does not call the edges re-read on the second step new, so they cannot truncate the answer', async () => {
        const { service } = storeOf(EDGES, CATALOG);

        const graph = await service.getGraph({ around: KREATOR, depth: 2, library: false, limit: 5 });

        expect(graph.edges).toHaveLength(5);
        expect(graph.truncated).toBe(false);
    });

    it('truncates a neighbourhood once a new edge is left over', async () => {
        const { service } = storeOf(EDGES, CATALOG);

        const graph = await service.getGraph({ around: KREATOR, depth: 2, library: false, limit: 4 });

        expect(graph.edges).toHaveLength(4);
        expect(graph.truncated).toBe(true);
    });

    it('answers a catalog artist nobody has asked about as a node on its own', async () => {
        const { service } = storeOf([], CATALOG);

        expect(await service.getGraph({ around: SLAYER, depth: 2, library: false, limit: 500 })).toEqual({
            nodes: [{ key: 'slayer', name: 'Slayer', artistId: SLAYER }],
            edges: [],
            truncated: false,
        });
    });

    it('keeps a library-only neighbourhood inside the catalog', async () => {
        const { service } = storeOf(EDGES, CATALOG);

        const graph = await service.getGraph({ around: KREATOR, depth: 2, library: true, limit: 500 });

        expect(graph.edges.map(e => `${e.from}>${e.to}`).sort()).toEqual(['kreator>slayer', 'slayer>kreator']);
        expect(graph.nodes.every(node => node.artistId !== undefined)).toBe(true);
    });

    it('404s on an artist the catalog does not hold', async () => {
        const { service } = storeOf(EDGES, CATALOG);

        await expect(
            service.getGraph({ around: '00000000-0000-4000-8000-0000000000ff', depth: 1, library: false, limit: 500 }),
        ).rejects.toMatchObject({
            statusCode: 404,
        });
    });
});
