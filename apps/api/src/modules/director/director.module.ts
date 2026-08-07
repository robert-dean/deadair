import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { LineupRepository } from './lineup.repository.js';
import { PlayHistoryRepository } from './play.history.repository.js';
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
    },
};
