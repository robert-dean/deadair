import { Injectable } from 'injectkit';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { SimilarityService } from '#modules/similarity/similarity.service.js';
import { PLAY_HISTORY_RETENTION_DAYS, PlayHistoryRepository } from './play.history.repository.js';
import { songKey } from './rotation.keys.js';
import { planRoute, type RouteStop as PlannedStop } from './route.planner.js';
import { RouteRepository, type StopRecord } from './route.repository.js';
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
        private readonly history: PlayHistoryRepository,
        private readonly identity: StationIdentity,
        // Read-only, and for one label: what a similarity source calls itself.
        private readonly plugins: PluginRegistry,
    ) {}

    /**
     * One record for each stop: one the operator liked if there is one, and otherwise the one that has
     * gone longest without airing (never aired first), so a route walked twice does not play the same
     * hour twice. A stop with nothing the station can air is left out, and the route closes up around it.
     */
    async records(stops: readonly PlannedStop[]): Promise<{ stop: PlannedStop; record: StopRecord }[]> {
        const [held, aired] = await Promise.all([
            Promise.all(stops.map(stop => this.routes.recordsBy(stop.artistKey))),
            this.history.lastAiredSince(PLAY_HISTORY_RETENTION_DAYS, this.identity.stationKey),
        ]);

        return stops.flatMap((stop, index) => {
            const lastAired = (record: StopRecord) => aired.get(songKey(record.title, [stop.name]))?.toMillis() ?? Number.NEGATIVE_INFINITY;
            const chosen = [...held[index]!].sort((left, right) => Number(right.liked) - Number(left.liked) || lastAired(left) - lastAired(right))[0];
            return chosen === undefined ? [] : [{ stop, record: chosen }];
        });
    }

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
            stops: stops.map(stop => stopView(stop, id => this.plugins.get(id)?.manifest?.name)),
            factual: stops.filter(stop => stop.link?.kind === 'credit').length,
            similar: stops.filter(stop => stop.link?.kind === 'similar').length,
        };
    }
}

/** One stop as the wire carries it: the link flattened, each field absent rather than blank. */
function stopView(stop: PlannedStop, nameOf: (pluginId: string) => string | undefined): RouteStop {
    const link = stop.link;
    if (link === undefined) return { artist: stop.name };
    if (link.kind === 'credit') return { artist: stop.name, link: 'credit', sharedTitle: link.title, sharedLead: link.lead };
    const sourceName = nameOf(link.source);
    return { artist: stop.name, link: 'similar', source: link.source, ...(sourceName === undefined ? {} : { sourceName }) };
}
