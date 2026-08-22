import { ServerKitModule } from '@maroonedsoftware/koa';
import { HealthModule } from './health/health.module.js';
import { DataConnectionsModule, DataModule } from './data/data.module.js';
import { CryptoModule } from './crypto/crypto.module.js';
import { AuthenticationModule } from './authentication/authentication.module.js';
import { PermissionsModule } from './permissions/permissions.module.js';
import { PolicyModule } from './policy/policy.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { OnboardingModule } from './onboarding/onboarding.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { StreamModule } from './stream/stream.module.js';
import { PluginsModule } from './plugins/plugins.module.js';
import { PlaylistsModule } from './playlists/playlists.module.js';
import { ChartsModule } from './charts/charts.module.js';
import { NewsModule } from './news/news.module.js';
import { TopicsModule } from './topics/topics.module.js';
import { SimilarityModule } from './similarity/similarity.module.js';
import { ScrobbleModule } from './scrobble/scrobble.module.js';
import { LlmModule } from './llm/llm.module.js';
import { PersonasModule } from './personas/personas.module.js';
import { ScheduleModule } from './schedule/schedule.module.js';
import { RenderModule } from './render/render.module.js';
import { PlayoutModule } from './playout/playout.module.js';
import { DirectorModule } from './director/director.module.js';
import { NowPlayingModule } from './nowplaying/nowplaying.module.js';
import { ActivityModule } from './activity/activity.module.js';
import { StorageModule } from './storage/storage.module.js';
import { EnrichmentModule } from './enrichment/enrichment.module.js';
import { ProductionsModule } from './productions/productions.module.js';
import { StationModule } from './station/station.module.js';
import { AnalysisModule } from './analysis/analysis.module.js';
import { ArtModule } from './art/art.module.js';
import { LoggingModule } from '#src/logging/logging.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { withBoundedShutdown } from './shared/shutdown.guard.js';

// Registered in dependency order: infrastructure (data, shared, messaging,
// events) first, then the single-actor identity/auth foundation. IdentityModule
// is a list of modules, spread in place. Add your app's domain modules after
// this chassis set.
//
// SHUTDOWN runs in REVERSE registration order, so teardown mirrors setup: a module releases what it
// holds while everything it depends on is still alive. That is the plain reading, and for nearly
// every entry below it is the only thing to know — the position is a dependency order and teardown
// now follows from it for free.
//
// The one counter-intuitive consequence is at the TOP of the list rather than the bottom: a module
// that must close LAST has to register FIRST. `LoggingModule` and `DataConnectionsModule` are the
// two, and both are there for that reason alone — neither registers, starts or readies anything, so
// sitting in front of `HealthModule` costs boot nothing. Two rules, both of them bugs measured on
// this install rather than reasoned about:
//
//   - Nothing that others depend on may close in its own position. `DataConnectionsModule` is the
//     whole of that today: the pools have to outlive every module that writes during its own
//     teardown, which now means registering ahead of `DataModule` rather than behind everything.
//   - No hook may cost the ones after it their teardown, or the process its exit. That is
//     `withBoundedShutdown` at the bottom of this file, and the reversal did not change it: the
//     loop still catches nothing and bounds nothing.
const ordered: ServerKitModule[] = [
    // First so it tears down LAST: its shutdown hook closes the process-level RotatingLogStore, and
    // every other module's shutdown logging has to be flushed through FileTeeLogger before that
    // happens — including the two lines DataConnectionsModule writes immediately before it. It has
    // no setup of its own; the store is built in `setup.server.ts` before any container exists.
    LoggingModule,
    // Second so it tears down second-to-last, with only LoggingModule left after it. It registers
    // nothing and starts nothing: it exists only to close the database and Redis once every module
    // that writes during its own teardown has finished. With the close left in DataModule's own
    // position the director's flush of the running order, which is a guarantee rather than a
    // nicety, was lost on nine of the shutdowns in this install's log. See DataConnectionsModule.
    DataConnectionsModule,
    // First of the modules that actually register something, and it depends on nothing: a probe
    // asking whether this process is up while everything below is still starting wants the true
    // answer rather than a 404 that reads as a wrong URL. It registers one singleton and starts
    // nothing.
    HealthModule,
    DataModule,
    CryptoModule,
    AuthenticationModule,
    PermissionsModule,
    PolicyModule,
    // Before CatalogModule: catalog reads join `art_assets` so a row that has a
    // locally cached cover reports that instead of the upstream URL. Nothing
    // here reaches back into the catalog.
    ArtModule,
    CatalogModule,
    OnboardingModule,
    SettingsModule,
    // After SettingsModule: it renders the Icecast/Liquidsoap config from the
    // `stream.*` settings, and seeds the secrets those settings hold. Nothing
    // else depends on it.
    StreamModule,
    // Last: a plugin's host reaches into the chassis (data, crypto, logging),
    // so everything it depends on must already be registered.
    PluginsModule,
    // After PluginsModule, and it is teardown that fixes the position: shutdown runs backwards, so
    // registering here is what stops the workers consuming BEFORE PluginsModule disposes the plugin
    // instances under them. It used to sit up beside PolicyModule, which bought the same guarantee
    // while teardown ran forwards.
    //
    // Its ready() is strictly better here than it was there. The ready phase runs only once every
    // module's start() has settled, so workers never dequeued against an empty PluginRegistry; but
    // ready hooks still run in registration order, so from up there plugins were discovered and not
    // yet INITIALIZED. From here they are both, which closes a gap jobs.module.ts had to argue was
    // tolerable rather than absent.
    JobsModule,
    // After PluginsModule: it resolves PluginRegistry and PluginInvoker, which
    // PluginsModule registers.
    PlaylistsModule,
    // After PluginsModule for the same reason, and before LlmModule and
    // DirectorModule, which are the two that ask it for a chart: one as a tool a
    // model may call, one as a source of names for a refill. It starts nothing.
    ChartsModule,
    // Beside ChartsModule and for the same reasons: after PluginsModule, before the
    // LLM and the director, no loop of its own. The two are siblings — one says what
    // is popular, the other who sounds alike, and both answer in names that the pick
    // path judges.
    SimilarityModule,
    // Beside the two above and for the same reasons: after PluginsModule, before
    // the LLM that reads it as a tool, no loop of its own. What it answers with is
    // not a name the pick path can judge but a FACT, and the only thing anything
    // does with a fact is say it — which is why nothing below it schedules from
    // this one.
    NewsModule,
    // After every module that OWNS a sort of break's subjects — NewsModule today, weather
    // tomorrow — and before DirectorModule, which reads one back when a break is written.
    // The vocabulary is the operator's ("technology", "Atlanta") and the registry that says
    // which kinds have subjects at all is an explicit list, exactly as the LLM's tool sources
    // are, which is why the edge points this way.
    TopicsModule,
    // After PluginsModule, and before DirectorModule, which resolves it on the aired
    // edge. Unlike its two neighbours above this one SENDS, so its queue is durable —
    // but it still starts nothing: the queue fills on a track boundary and drains on
    // a cron, and this module owns neither.
    ScrobbleModule,
    // After PluginsModule for the same reason, and before RenderModule and
    // DirectorModule, which are the two that will ask a model for words. It owns
    // no loop and starts nothing: a generation happens because something asked.
    LlmModule,
    // Before RenderModule and DirectorModule, which are the two that read a
    // persona: one for the voice a break is spoken in, one for the words and the
    // phrasings underneath them. It owns no loop — its ready() seeds a station
    // that has no personas at all.
    //
    // It DOES reach forward into DirectorModule now, at request time: putting a
    // persona on air has to tell the show that is running, and the director is the
    // one owner of that. ScheduleModule below does the same from further up. The
    // list is a lifecycle order rather than a resolution one, so a scoped service
    // resolving a singleton registered later in it is fine; what would not be is
    // reaching for one at boot.
    PersonasModule,
    // After PlaylistsModule and PersonasModule, whose rows a slot names, and before
    // DirectorModule, which is the thing that actually changes the station over.
    // Nothing here reaches forward into any of them: a slot stores ids and both
    // readers resolve them at the moment of use, which is what lets a deleted
    // persona or a vanished playlist fall back rather than fault.
    //
    // It owns no loop and starts nothing, deliberately. The schedule is a stored
    // document with a pure resolver over it and a timer that posts commands; a
    // second stateful owner of what airs is the defect `on-air-ownership.md`
    // exists to remove. This module is only the table underneath.
    ScheduleModule,
    // Before PlayoutModule: the transport resolves a committed segment by reading
    // a row and a file from here, the way it resolves a track through a plugin.
    // Nothing here reaches back into playout or the director.
    RenderModule,
    // After PlaylistsModule and RenderModule: its resolvers reach the plugin
    // registry and invoker for a track's stream URL and the segment store for
    // everything else, and its ready() reads the bridge secret the StreamModule
    // above has already seeded and materialized.
    PlayoutModule,
    // After PlayoutModule: the public now-playing answer reads the same singleton
    // rundown the transport does. It owns nothing and starts nothing.
    NowPlayingModule,
    // After PluginsModule for the same reason as EnrichmentModule, and after
    // PlayoutModule as well: it measures a track by fetching the same audio the
    // transport would play, through that module's `CachedTrackResolver` and then
    // its `PluginTrackResolver`. A plugin cannot ask another plugin for a stream
    // URL, so resolving one is the host's job and this borrows the resolvers that
    // already do it — in that order, because a record the station has cached is
    // measured from the file that will actually air rather than from a fresh
    // download of it.
    //
    // Before DirectorModule, which reads the measurements back the other way:
    // `PickResolver` stamps a track's cue points onto the item it builds, so the
    // silence at the head and tail of a record is trimmed before the player ever
    // sees it.
    AnalysisModule,
    // After PlayoutModule, CatalogModule and PlaylistsModule: it drives the
    // singleton rundown, and its lineups are built from catalog tracks and from
    // playlists read through the plugin host. Also after AnalysisModule, above.
    DirectorModule,
    // After ArtModule, RenderModule and PlayoutModule, whose stores it resolves to
    // ask each one what is actually on disk. Nothing depends on it in turn: it owns
    // no loop, starts nothing, and is resolved only by a request, so this is a
    // dependency order rather than a lifecycle one.
    StorageModule,
    // After DirectorModule, which is the last module that produces events. The
    // position matters less here than anywhere else in this list: it starts
    // nothing and nothing resolves it during another module's start() or
    // ready(), so the modules above may write events without a cycle.
    ActivityModule,
    // After PluginsModule for the same reason as PlaylistsModule: it fans a
    // track out across every enrichment plugin through the registry and the
    // invoker. It also writes catalog rows, but through its own repository, so
    // it does not need CatalogModule.
    //
    // And after DirectorModule, which is newer and narrower: `LineupPriorityReader`
    // resolves `StationLineupRepository` to find out what the station is about to
    // play, so the walk can describe those records before the rest of the catalog.
    // It only READS the running order — the director remains its only writer.
    EnrichmentModule,
    // After RenderModule and DirectorModule, and it is a real edge rather than a tidy one: a
    // production's beats ARE segments, so making one goes through the render path's claims and its
    // content store, and a finished production reaches air only through the director, which is the
    // sole writer of the running order. Nothing in either reaches forward into this, and this owns
    // no loop — a production is made entirely by jobs, one per pass.
    ProductionsModule,
    // After everything it reads, which is nearly everything: playout for the silence diagnosis, the
    // director for the running order, the catalog for the library's state, and the plugin host. It
    // composes them and owns nothing, so nothing resolves it back — which is what makes the bottom
    // of the list a free position rather than a compromise.
    StationModule,
];

/**
 * The list as ServerKit gets it: same modules, same order, with every teardown bounded.
 *
 * Applied here rather than inside each hook because the guarantee is about the LIST — no module may
 * cost the ones that tear down after it their own teardown, and none may cost the process its exit.
 * A module added later gets it without knowing about it.
 */
export const modules: ServerKitModule[] = ordered.map(module => withBoundedShutdown(module));
