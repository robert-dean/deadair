import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { CandidatesRepository } from './candidates.repository.js';
import { CatalogSetGenerator } from './catalog.set.generator.js';
import { LineupRepository } from './lineup.repository.js';
import { PickResolver } from './pick.resolver.js';
import { PlayHistoryRepository } from './play.history.repository.js';
import { SetGenerator } from './set.generator.js';
import { StationAirRepository } from './station.air.repository.js';

/**
 * The station's programming: the lineups it means to air, and which one is on.
 *
 * Registered after PlayoutModule, whose singleton `Rundown` the director drives,
 * and after CatalogModule and PlaylistsModule, which are where its tracks come
 * from. Nothing in the chassis reaches back into it.
 *
 * Storage only, so far. The reactor that keeps the rundown topped up from a
 * lineup arrives with the rest of the director.
 */
export const DirectorModule: ServerKitModule = {
    name: 'Director',
    setup: async (registry: Registry, _: AppConfig) => {
        // Scoped like every other repository here: the job runner gives each
        // execution its own scope, so these are per-run there and per-request on
        // the request path.
        registry.register(LineupRepository).useClass(LineupRepository).asScoped();
        registry.register(StationAirRepository).useClass(StationAirRepository).asScoped();
        registry.register(PlayHistoryRepository).useClass(PlayHistoryRepository).asScoped();
        registry.register(CandidatesRepository).useClass(CandidatesRepository).asScoped();

        // The selection seam. Bound to the deterministic catalog draw; an LLM DJ
        // later replaces this one line and nothing downstream of the token changes,
        // which is the whole reason a pick is a NAME rather than an id.
        registry.register(SetGenerator).useClass(CatalogSetGenerator).asScoped();
        registry.register(PickResolver).useClass(PickResolver).asScoped();
    },
};
