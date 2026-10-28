import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { SimilarityGraph, type SimilarityEdge, type SimilarityGraphQuery, type SimilarityNode } from '#modules/catalog/types/catalog.types.js';
import { SimilarityStoreRepository, type StoredEdge } from './similarity.store.repository.js';

/**
 * Who resembles whom, as the station has stored it, for drawing.
 *
 * Reads the similarity store and never the sources: a graph the console asks for must not cost a
 * provider call per artist on the screen, and what the store holds is exactly what the station has
 * acted on. So an artist nobody has asked about has no edges of its own here, which is the truth
 * about the store rather than a gap in the answer.
 *
 * Edges stay DIRECTED, as stored. That A names B and B names A are two facts, and a reader that
 * wants them as one line can fold them; a reader handed one line cannot unfold it.
 */
@Injectable()
export class SimilarityGraphService {
    constructor(private readonly store: SimilarityStoreRepository) {}

    /** @throws 404 when `around` names no catalog artist, or one that was merged away. */
    async getGraph(query: SimilarityGraphQuery): Promise<SimilarityGraph> {
        const { around, depth, library, limit } = query;

        let edges: StoredEdge[];
        let truncated: boolean;
        const names = new Map<string, string>();

        if (around === undefined) {
            const rows = await this.store.edges({ library, limit: limit + 1 });
            truncated = rows.length > limit;
            edges = rows.slice(0, limit);
        } else {
            const centre = await this.store.catalogArtist(around);
            if (centre === undefined) throw httpError(404).withDetails({ message: `artist "${around}" is not in the catalog` });
            names.set(centre.artistKey, centre.name);
            ({ edges, truncated } = await this.neighbourhood(centre.artistKey, depth, library, limit));
        }

        for (const edge of edges) {
            if (!names.has(edge.from)) names.set(edge.from, edge.fromName);
            if (!names.has(edge.to)) names.set(edge.to, edge.toName);
        }

        const catalog = new Map((await this.store.catalogArtists([...names.keys()])).map(artist => [artist.artistKey, artist]));
        const nodes: SimilarityNode[] = [...names].map(([key, name]) => {
            const artist = catalog.get(key);
            return artist === undefined ? { key, name } : { key, name: artist.name, artistId: artist.id };
        });

        return parseAndValidate({ nodes, edges: edges.map(toEdge), truncated }, SimilarityGraph);
    }

    /**
     * The edges within `depth` steps of `key`, either way along them, best-ranked first at each step.
     *
     * Each step reads `limit + 1` edges beyond the ones already found, because a step re-reads the
     * edges that joined it to the step before and those are not new; only a NEW edge left over once
     * `limit` is reached makes the answer truncated.
     */
    private async neighbourhood(key: string, depth: number, library: boolean, limit: number): Promise<{ edges: StoredEdge[]; truncated: boolean }> {
        const found = new Map<string, StoredEdge>();
        const seen = new Set([key]);
        let frontier = [key];

        for (let step = 0; step < depth && frontier.length > 0; step++) {
            const next: string[] = [];
            for (const edge of await this.store.edges({ touching: frontier, library, limit: found.size + limit + 1 })) {
                const id = `${edge.from}\u0000${edge.to}`;
                if (found.has(id)) continue;
                if (found.size === limit) return { edges: [...found.values()], truncated: true };
                found.set(id, edge);
                for (const end of [edge.from, edge.to]) {
                    if (seen.has(end)) continue;
                    seen.add(end);
                    next.push(end);
                }
            }
            frontier = next;
        }
        return { edges: [...found.values()], truncated: false };
    }
}

function toEdge(edge: StoredEdge): SimilarityEdge {
    return {
        from: edge.from,
        to: edge.to,
        rank: edge.rank,
        source: edge.source,
        ...(edge.match === undefined ? {} : { match: edge.match }),
    };
}
