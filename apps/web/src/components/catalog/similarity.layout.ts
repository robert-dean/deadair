import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force';
import type { SimilarityGraph } from '@deadair/sdk';

/** One artist, placed. */
export interface PlacedNode extends SimulationNodeDatum {
    key: string;
    name: string;
    /** The catalog artist, when the catalog holds one. */
    artistId?: string;
    /** How many other artists it is joined to, either way. */
    degree: number;
    radius: number;
    x: number;
    y: number;
}

/** Two artists joined, whichever of them named the other. */
export interface PlacedLink {
    source: PlacedNode;
    target: PlacedNode;
    /** From the best rank either side gave the other: 1 for a first-named neighbour, falling away after. */
    weight: number;
    /** Both named each other, which is the strongest thing the store can say. */
    mutual: boolean;
}

export interface PlacedGraph {
    nodes: PlacedNode[];
    links: PlacedLink[];
}

/**
 * How strongly one artist naming another holds them together, from its rank in the naming artist's answer.
 *
 * From the RANK and never the source's own score, because the scores of two sources mean different
 * things: a Last.fm match of 0.4 and a Deezer one are not the same distance, and a layout that read
 * them as one would draw the source rather than the music.
 */
export const rankWeight = (rank: number): number => 1 / (rank + 1);

/**
 * The answer's directed edges folded into one link per pair, each node counted for how joined it is.
 *
 * The answer keeps A-names-B and B-names-A apart on purpose, and this is the reader that wants them
 * as one line: drawn twice, a mutual pair would read as two relationships rather than a strong one.
 */
export function foldGraph(graph: SimilarityGraph): PlacedGraph {
    const nodes = new Map<string, PlacedNode>(
        graph.nodes.map(node => [
            node.key,
            { key: node.key, name: node.name, ...(node.artistId === undefined ? {} : { artistId: node.artistId }), degree: 0, radius: 0, x: 0, y: 0 },
        ]),
    );

    const pairs = new Map<string, { source: PlacedNode; target: PlacedNode; weight: number; directions: Set<string> }>();
    for (const edge of graph.edges) {
        const from = nodes.get(edge.from);
        const to = nodes.get(edge.to);
        if (from === undefined || to === undefined || from === to) continue;

        const [source, target] = from.key < to.key ? [from, to] : [to, from];
        const id = `${source.key}\u0000${target.key}`;
        const weight = rankWeight(edge.rank);
        const pair = pairs.get(id);
        if (pair === undefined) {
            pairs.set(id, { source, target, weight, directions: new Set([edge.from]) });
        } else {
            pair.weight = Math.max(pair.weight, weight);
            pair.directions.add(edge.from);
        }
    }

    const links = [...pairs.values()].map(({ source, target, weight, directions }) => ({ source, target, weight, mutual: directions.size === 2 }));
    for (const link of links) {
        link.source.degree++;
        link.target.degree++;
    }
    for (const node of nodes.values()) node.radius = nodeRadius(node.degree);

    return { nodes: [...nodes.values()], links };
}

/** A node's size from how joined it is: square-rooted, so the hub of a scene does not swallow the canvas. */
export const nodeRadius = (degree: number): number => Math.min(4 + Math.sqrt(degree) * 1.8, 18);

/**
 * Places the folded graph, run to rest before it is drawn rather than animated.
 *
 * A settled layout is the same picture every time the page is opened, since d3 seeds its starting
 * positions on a fixed spiral rather than at random; an animated one is a picture that will not hold
 * still while somebody reads it. `forceX`/`forceY` rather than `forceCenter`, because the second only
 * recentres the mass and lets every island that is not joined to the rest drift off the canvas.
 */
export function layoutGraph(graph: SimilarityGraph, ticks = 300): PlacedGraph {
    const placed = foldGraph(graph);

    forceSimulation(placed.nodes)
        .force(
            'link',
            forceLink<PlacedNode, PlacedLink>(placed.links)
                .distance(link => 40 + 60 * (1 - link.weight))
                .strength(link => 0.2 + 0.6 * link.weight),
        )
        .force('charge', forceManyBody<PlacedNode>().strength(-120).distanceMax(500))
        // Pulled in harder top to bottom than side to side, so the picture comes out about as wide as
        // the canvas it is drawn on is, rather than a column down the middle of it.
        .force('x', forceX<PlacedNode>(0).strength(0.03))
        .force('y', forceY<PlacedNode>(0).strength(0.09))
        .force(
            'collide',
            forceCollide<PlacedNode>(node => node.radius + 2),
        )
        .stop()
        .tick(ticks);

    return placed;
}

/** The box the placed nodes occupy, radii included, for fitting the drawing to its canvas. */
export function boundsOf(nodes: readonly PlacedNode[]): { minX: number; minY: number; maxX: number; maxY: number } {
    if (nodes.length === 0) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
    return {
        minX: Math.min(...nodes.map(node => node.x - node.radius)),
        minY: Math.min(...nodes.map(node => node.y - node.radius)),
        maxX: Math.max(...nodes.map(node => node.x + node.radius)),
        maxY: Math.max(...nodes.map(node => node.y + node.radius)),
    };
}

/** The node under a point in layout space, the topmost when two overlap, or `undefined`. A few pixels of slack make small nodes catchable. */
export function nodeAt(nodes: readonly PlacedNode[], x: number, y: number, slack = 3): PlacedNode | undefined {
    for (let index = nodes.length - 1; index >= 0; index--) {
        const node = nodes[index]!;
        const reach = node.radius + slack;
        if ((node.x - x) ** 2 + (node.y - y) ** 2 <= reach * reach) return node;
    }
    return undefined;
}
