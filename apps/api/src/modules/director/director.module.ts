import { Container, Registry } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { BreakPlanner } from './break.planner.js';
import { BreakRequestRepository } from './break.request.repository.js';
import { BreakWriterRegistry } from './break.writer.registry.js';
import { ModelNewsBreakWriter } from './model.news.break.writer.js';
import { ModelTalkBreakWriter } from './model.talk.break.writer.js';
import { NewsBreakWriter } from './news.break.writer.js';
import { BulletinSource, ReadLog } from './bulletin.source.js';
import { ModelWelcomeWriter } from './model.welcome.writer.js';
import { TalkBreakWriter } from './talk.break.writer.js';
import { WelcomeAnnouncer } from './welcome.announcer.js';
import { WelcomeWriter } from './welcome.writer.js';
import { CandidatesRepository } from './candidates.repository.js';
import { ClockBandRepository } from './clock.band.repository.js';
import { ClockService } from './clock.service.js';
import { AdvisoryWatch } from './advisory.watch.js';
import { CatalogSetGenerator } from './catalog.set.generator.js';
import { ChartSetGenerator } from './chart.set.generator.js';
import { ModelSetGenerator } from './model.set.generator.js';
import { SimilarSetGenerator } from './similar.set.generator.js';
import { DirectorConsoleService } from './director.console.service.js';
import { DirectorService } from './director.service.js';
import { PickResolver } from './pick.resolver.js';
import { RefillPreemption } from './refill.preemption.js';
import { PlayHistoryRepository } from './play.history.repository.js';
import { ProviderTrackLookup } from './provider.track.lookup.js';
import { SetGenerator } from './set.generator.js';
import { SetGeneratorChain } from './set.generator.chain.js';
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
        // What the station has been asked to say, as opposed to what its own rules decided. Scoped
        // like the rest: the director opens a scope per unit of work and the render job gets one per
        // execution, and both write these rows.
        registry.register(BreakRequestRepository).useClass(BreakRequestRepository).asScoped();
        // The station's format clock. Scoped for the same reason, and read by two things that are
        // not each other's callers: the break planner's pass and the production scheduler's.
        registry.register(ClockBandRepository).useClass(ClockBandRepository).asScoped();

        // The selection seam, and its ranking. Shaped exactly like the writer seam below and for
        // the same reason: several bindings may choose what the station plays, THIS ORDER is the
        // preference order, and the deterministic draw stays the floor by being the final entry.
        // The one difference is that the chain TOPS UP rather than falling through — a generator
        // that named six of fifteen has done most of the job — which is why a set is not a break.
        registry.register(ModelSetGenerator).useClass(ModelSetGenerator).asScoped();
        registry.register(ChartSetGenerator).useClass(ChartSetGenerator).asScoped();
        registry.register(SimilarSetGenerator).useClass(SimilarSetGenerator).asScoped();
        // A SINGLETON among scoped generators, and only because it holds one boolean. The draw
        // below discovers that the advisory policy has left the station nothing to play, and a feed
        // producer writes on edges — so the flag saying "already said this" has to outlive the
        // per-refill scope the discovery happens in. See `AdvisoryWatch`.
        registry.register(AdvisoryWatch).useClass(AdvisoryWatch).asSingleton();
        registry.register(CatalogSetGenerator).useClass(CatalogSetGenerator).asScoped();
        // How the model binding tells the job that a break took the model off it, which is the one
        // way a refill can come back thin that is worth asking again about. SCOPED, unlike the watch
        // above and for the opposite reason: this says "the refill running in THIS scope was
        // interrupted", and a singleton would let one refill's interruption buy another one a retry.
        registry.register(RefillPreemption).useClass(RefillPreemption).asScoped();
        registry
            .register(SetGenerator)
            .useFactory(
                (container: Container) =>
                    // The model first and the catalog draw last, which is the whole of how they are
                    // ranked. Everything the model can do wrong is topped up by the entry below it,
                    // and the entry below it cannot fail.
                    //
                    // The chart sits between them, and that position is an argument rather than a
                    // gap to fill. Above the floor, because a published chart is a stronger claim
                    // about what to play than a weighted draw from whatever the library holds.
                    // Below the model, because the model can act on the operator's brief and this
                    // can only choose which chart to read — and because a chart takes only the
                    // share `rotation.chartMix` allows, so it must not get first refusal on a batch
                    // the model was going to programme properly.
                    //
                    // The similarity binding sits behind the chart on a weaker version of the same
                    // argument: a chart is a claim somebody published, and a neighbour of something
                    // that happened to air is an inference from the station's own recent history.
                    // Both take only their configured share, so the order between them decides who
                    // gets the good slots rather than who gets any.
                    new SetGeneratorChain(
                        [
                            container.get(ModelSetGenerator),
                            container.get(ChartSetGenerator),
                            container.get(SimilarSetGenerator),
                            container.get(CatalogSetGenerator),
                        ],
                        container.get(ActivityRecorder),
                        container.get(AppConfig),
                        container.get(Logger),
                    ),
            )
            .asScoped();
        // The rung under the resolver: a record the catalog has never seen, found at a provider and
        // taken into the library. Scoped with the plugin registry and invoker it reads.
        registry.register(ProviderTrackLookup).useClass(ProviderTrackLookup).asScoped();
        registry.register(PickResolver).useClass(PickResolver).asScoped();

        // The writer seam, keyed by `segments.kind`. The list is explicit rather than discovered,
        // following `ToolRegistry`: what the station can say is one readable line here instead of
        // the sum of whatever registered itself. Several writers may claim one kind and THIS ORDER
        // is the preference order — a model binding goes in front of `TalkBreakWriter` rather than
        // instead of it, and the registry falls through to whatever is last when the ones above it
        // decline. So the station's own words stay the floor by being the final entry.
        registry.register(ModelTalkBreakWriter).useClass(ModelTalkBreakWriter).asScoped();
        registry.register(TalkBreakWriter).useClass(TalkBreakWriter).asScoped();
        registry.register(ModelWelcomeWriter).useClass(ModelWelcomeWriter).asScoped();
        registry.register(WelcomeWriter).useClass(WelcomeWriter).asScoped();
        registry.register(ModelNewsBreakWriter).useClass(ModelNewsBreakWriter).asScoped();
        registry.register(NewsBreakWriter).useClass(NewsBreakWriter).asScoped();
        // What the station has already read out. A SINGLETON beside the scoped source below, for the
        // same reason `AdvisoryWatch` is one among the scoped generators: "the station already said
        // this" has to outlive the scope that discovered it. It was a field on `BulletinSource` and
        // therefore per-job, which made it inert — ten consecutive bulletins read the same three
        // stories on 19 August. See `ReadLog`.
        registry.register(ReadLog).useClass(ReadLog).asSingleton();
        // Scoped with the `NewsService` it reads — which is why the log above is registered apart
        // from it rather than made a singleton itself, since that would capture a scoped
        // `NewsService` at the root. What a bulletin is written FROM, fetched once for whichever
        // writer takes it, so the model and the floor read the same headlines.
        registry.register(BulletinSource).useClass(BulletinSource).asScoped();
        registry
            .register(BreakWriterRegistry)
            .useFactory(
                (container: Container) =>
                    new BreakWriterRegistry(
                        // The model first and the station's own words last, which is the whole of
                        // how they are ranked. Everything the model can do wrong falls through to
                        // the line below it, and the line below it cannot fail.
                        // The welcome is a second KIND rather than a third writer of the first: a
                        // greeting looks forward and a talk break looks back, so a writer for one is
                        // wrong for the other whatever it is handed. Each kind is ranked the same
                        // way within itself — the model in front, the station's own words as the
                        // floor behind it.
                        [
                            container.get(ModelTalkBreakWriter),
                            container.get(TalkBreakWriter),
                            container.get(ModelWelcomeWriter),
                            container.get(WelcomeWriter),
                            // The third kind, ranked the same way within itself. It is the one where
                            // the floor is not merely a safety net: reading a published headline
                            // cannot be wrong about the news, and everything a model adds to that is
                            // something a listener has no way to check.
                            container.get(ModelNewsBreakWriter),
                            container.get(NewsBreakWriter),
                        ],
                        container.get(Logger),
                    ),
            )
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
        // The operator's half of the format clock. Scoped like every other request-facing service,
        // and it tells the director nothing: a band is read off the table on the next commit pass.
        registry.register(ClockService).useClass(ClockService).asScoped();

        // The first producer on the station bus: somebody tuned in, so ask for a greeting. A
        // singleton because it holds a subscription, and its own class rather than a branch in the
        // director because what the station does about a listener arriving is a programming decision
        // and should be one readable file.
        registry.register(WelcomeAnnouncer).useClass(WelcomeAnnouncer).asSingleton();
    },

    ready: async (container: Container, signal: AbortSignal) => {
        if (signal.aborted) return;

        // In `ready` rather than `start`: it reads what was on air before the restart,
        // which is work the first request does not depend on, and it drives a rundown
        // whose own pusher only begins in PlayoutModule's ready.
        await container.get(DirectorService).start();

        // After the director, and it has to be: a greeting asked for before the running order has
        // been read back is one declined for a station that is not airing anything.
        container.get(WelcomeAnnouncer).start();
    },

    shutdown: async (container: Container) => {
        // First, so nothing asks for a greeting while the director is flushing what it holds.
        container.get(WelcomeAnnouncer).stop();
        // Awaited: the stop flushes whatever the persist throttle owes, and a shutdown that did
        // not wait would cost the station its last couple of seconds of transitions and replay a
        // record for them.
        await container.get(DirectorService).stop();
    },
};
