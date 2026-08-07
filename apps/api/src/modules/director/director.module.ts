import { Container, Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { CandidatesRepository } from './candidates.repository.js';
import { CatalogSetGenerator } from './catalog.set.generator.js';
import { DirectorConsoleService } from './director.console.service.js';
import { DirectorService } from './director.service.js';
import { ExtendLineupJob } from './extend.lineup.job.js';
import { LineupRepository } from './lineup.repository.js';
import { PickResolver } from './pick.resolver.js';
import { PlayHistoryRepository } from './play.history.repository.js';
import { SetGenerator } from './set.generator.js';
import { StationAirRepository } from './station.air.repository.js';

/**
 * The station's programming: the lineups it means to air, which one is on, and
 * the actor that keeps the running order full from it.
 *
 * Registered after PlayoutModule, whose singleton `Rundown` the director drives,
 * and after CatalogModule and PlaylistsModule, which are where its tracks come
 * from. Nothing in the chassis reaches back into it.
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
        registry.register(ExtendLineupJob).useClass(ExtendLineupJob).asScoped();

        // The reactor is a singleton by necessity, not for tidiness: it holds the
        // rundown subscriptions and the lineup on air, and a per-request copy would
        // give every caller a different, empty view of what the station is doing.
        registry.register(DirectorService).useClass(DirectorService).asSingleton();
        // Its request-facing half is scoped like any other service, and only holds a
        // reference to the singleton above.
        registry.register(DirectorConsoleService).useClass(DirectorConsoleService).asScoped();
    },

    ready: async (container: Container, signal: AbortSignal) => {
        if (signal.aborted) return;

        // In `ready` rather than `start`: it reads what was on air before the restart,
        // which is work the first request does not depend on, and it drives a rundown
        // whose own pusher only begins in PlayoutModule's ready.
        await container.get(DirectorService).start();
    },

    shutdown: async (container: Container) => {
        container.get(DirectorService).stop();
    },
};
