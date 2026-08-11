import { Container, Registry } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { BreakPlanner } from './break.planner.js';
import { BreakWriterRegistry } from './break.writer.registry.js';
import { TalkBreakWriter } from './talk.break.writer.js';
import { CandidatesRepository } from './candidates.repository.js';
import { CatalogSetGenerator } from './catalog.set.generator.js';
import { DirectorConsoleService } from './director.console.service.js';
import { DirectorService } from './director.service.js';
import { PickResolver } from './pick.resolver.js';
import { PlayHistoryRepository } from './play.history.repository.js';
import { SetGenerator } from './set.generator.js';
import { StationAirRepository } from './station.air.repository.js';
import { StationLineupRepository } from './station.lineup.repository.js';

/**
 * The station's programming: the one running order it is airing, and the actor
 * that owns it.
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
        registry.register(StationLineupRepository).useClass(StationLineupRepository).asScoped();
        registry.register(StationAirRepository).useClass(StationAirRepository).asScoped();
        registry.register(PlayHistoryRepository).useClass(PlayHistoryRepository).asScoped();
        registry.register(CandidatesRepository).useClass(CandidatesRepository).asScoped();

        // The selection seam. Bound to the deterministic catalog draw; an LLM DJ
        // later replaces this one line and nothing downstream of the token changes,
        // which is the whole reason a pick is a NAME rather than an id.
        registry.register(SetGenerator).useClass(CatalogSetGenerator).asScoped();
        registry.register(PickResolver).useClass(PickResolver).asScoped();

        // The writer seam, keyed by `segments.kind`. The list is explicit rather than discovered,
        // following `ToolRegistry`: what the station can say is one readable line here instead of
        // the sum of whatever registered itself. Several writers may claim one kind and THIS ORDER
        // is the preference order — a model binding goes in front of `TalkBreakWriter` rather than
        // instead of it, and the registry falls through to whatever is last when the ones above it
        // decline. So the station's own words stay the floor by being the final entry.
        registry.register(TalkBreakWriter).useClass(TalkBreakWriter).asScoped();
        registry
            .register(BreakWriterRegistry)
            .useFactory((container: Container) => new BreakWriterRegistry([container.get(TalkBreakWriter)], container.get(Logger)))
            .asScoped();

        // Scoped with the repository it reads. Called from the director's own pass, which is the
        // one thing that may change the running order.
        registry.register(BreakPlanner).useClass(BreakPlanner).asScoped();
        // ExtendLineupJob is deliberately NOT registered here. JobsModule registers
        // every class in `JobMappings` itself, transient, and registering it twice is
        // a boot failure rather than a merge.

        // The reactor is a singleton by necessity, not for tidiness: it holds the
        // rundown subscriptions and the running order itself, and a per-request copy
        // would give every caller a different, empty view of what the station is doing.
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
        // Awaited: the stop flushes whatever the persist throttle owes, and a shutdown that did
        // not wait would cost the station its last couple of seconds of transitions and replay a
        // record for them.
        await container.get(DirectorService).stop();
    },
};
