import { describe, expect, it } from 'vitest';
import type { SimilarityGraph } from '@deadair/sdk';

import { boundsOf, foldGraph, layoutGraph, nodeAt, nodeRadius, rankWeight } from '../../../src/components/catalog/similarity.layout';

const SLAYER = '11111111-1111-4111-8111-111111111111';

const graph = (edges: SimilarityGraph['edges'], extra: SimilarityGraph['nodes'] = []): SimilarityGraph => ({
    nodes: [{ key: 'slayer', name: 'Slayer', artistId: SLAYER }, { key: 'kreator', name: 'Kreator' }, { key: 'sodom', name: 'Sodom' }, ...extra],
    edges,
    truncated: false,
});

const edge = (from: string, to: string, rank: number) => ({ from, to, rank, source: 'deadair.lastfm' });

describe('foldGraph', () => {
    it('folds a pair named both ways into one mutual link, weighted by the better rank', () => {
        const { links } = foldGraph(graph([edge('slayer', 'kreator', 3), edge('kreator', 'slayer', 0)]));

        expect(links).toHaveLength(1);
        expect(links[0]?.mutual).toBe(true);
        expect(links[0]?.weight).toBe(rankWeight(0));
    });

    it('keeps a one-way naming as a link that is not mutual', () => {
        const { links } = foldGraph(graph([edge('slayer', 'sodom', 1)]));

        expect(links).toHaveLength(1);
        expect(links[0]?.mutual).toBe(false);
        expect(links[0]?.weight).toBe(0.5);
    });

    it('counts each artist once per neighbour, and sizes it from that', () => {
        const { nodes } = foldGraph(graph([edge('slayer', 'kreator', 0), edge('kreator', 'slayer', 0), edge('slayer', 'sodom', 1)]));

        const slayer = nodes.find(node => node.key === 'slayer')!;
        expect(slayer.degree).toBe(2);
        expect(slayer.radius).toBe(nodeRadius(2));
        expect(slayer.artistId).toBe(SLAYER);
        expect(nodes.find(node => node.key === 'kreator')).not.toHaveProperty('artistId');
    });

    it('drops an edge whose end the answer did not name, and a self-listing', () => {
        const { links } = foldGraph(graph([edge('slayer', 'nobody', 0), edge('slayer', 'slayer', 0)]));

        expect(links).toEqual([]);
    });
});

describe('layoutGraph', () => {
    it('places every node at a finite point, joined artists nearer each other than strangers', () => {
        const { nodes } = layoutGraph(graph([edge('slayer', 'kreator', 0), edge('kreator', 'slayer', 0)], [{ key: 'abba', name: 'ABBA' }]));

        for (const node of nodes) {
            expect(Number.isFinite(node.x)).toBe(true);
            expect(Number.isFinite(node.y)).toBe(true);
        }
        const at = (key: string) => nodes.find(node => node.key === key)!;
        const distance = (a: string, b: string) => Math.hypot(at(a).x - at(b).x, at(a).y - at(b).y);
        expect(distance('slayer', 'kreator')).toBeLessThan(distance('slayer', 'abba'));
    });

    it('draws the same picture every time', () => {
        const input = graph([edge('slayer', 'kreator', 0), edge('kreator', 'sodom', 1)]);

        const once = layoutGraph(input).nodes.map(node => [node.x, node.y]);
        const again = layoutGraph(input).nodes.map(node => [node.x, node.y]);

        expect(again).toEqual(once);
    });
});

describe('nodeAt and boundsOf', () => {
    const { nodes } = foldGraph(graph([]));
    nodes.forEach((node, index) => Object.assign(node, { x: index * 100, y: 0, radius: 5 }));

    it('finds the node under a point, with a little slack, and nothing between nodes', () => {
        expect(nodeAt(nodes, 101, 0)?.key).toBe('kreator');
        expect(nodeAt(nodes, 107, 0, 3)?.key).toBe('kreator');
        expect(nodeAt(nodes, 50, 0)).toBeUndefined();
    });

    it('bounds the nodes with their radii', () => {
        expect(boundsOf(nodes)).toEqual({ minX: -5, minY: -5, maxX: 205, maxY: 5 });
    });
});
