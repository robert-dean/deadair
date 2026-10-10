import { Injectable } from 'injectkit';
import { SimilarityService } from '#modules/similarity/similarity.service.js';
import { planRoute, type RouteStop as PlannedStop } from './route.planner.js';
import { RouteRepository } from './route.repository.js';
import type { ArtistRoute, RoutePreviewInput, RouteStop } from './types/director.types.js';

/**
 * Routes between two artists, as the console and a route on air ask for them.
 *
 * The planner (`route.planner.ts`) is pure and asks through ports; this is where those ports meet the
 * catalog and the similarity sources. Scoped, like both of them.
 */
@Injectable()
export class RouteService {
    constructor(
        private readonly routes: RouteRepository,
        private readonly similarity: SimilarityService,
    ) {}

    /** The cheapest route from `from` to `to`, or `undefined` when there is none to air. */
    plan(from: string, to: string): Promise<PlannedStop[] | undefined> {
        return planRoute(from, to, {
            owned: keys => this.routes.ownedArtists(keys),
            coCredits: key => this.routes.coCredits(key),
            neighbours: (name, limit) => this.similarity.similarTo({ name }, limit),
        });
    }

    /** What a route would be, without putting anything on air. */
    async preview(input: RoutePreviewInput): Promise<ArtistRoute> {
        const stops = await this.plan(input.from, input.to);
        if (stops === undefined) return { found: false, stops: [], factual: 0, similar: 0 };

        return {
            found: true,
            stops: stops.map(stopView),
            factual: stops.filter(stop => stop.link?.kind === 'credit').length,
            similar: stops.filter(stop => stop.link?.kind === 'similar').length,
        };
    }
}

/** One stop as the wire carries it: the link flattened, each field absent rather than blank. */
function stopView(stop: PlannedStop): RouteStop {
    const link = stop.link;
    if (link === undefined) return { artist: stop.name };
    if (link.kind === 'credit') return { artist: stop.name, link: 'credit', sharedTitle: link.title, sharedLead: link.lead };
    return { artist: stop.name, link: 'similar', source: link.source };
}
