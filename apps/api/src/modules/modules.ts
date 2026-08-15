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
import { SimilarityModule } from './similarity/similarity.module.js';
import { ScrobbleModule } from './scrobble/scrobble.module.js';
import { LlmModule } from './llm/llm.module.js';
import { PersonasModule } from './personas/personas.module.js';
import { RenderModule } from './render/render.module.js';
import { PlayoutModule } from './playout/playout.module.js';
import { DirectorModule } from './director/director.module.js';
import { NowPlayingModule } from './nowplaying/nowplaying.module.js';
import { ActivityModule } from './activity/activity.module.js';
import { EnrichmentModule } from './enrichment/enrichment.module.js';
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
// SHUTDOWN runs in this SAME order rather than in reverse, which is the one thing about this list
// that surprises everybody, because a dependency order read forwards is a teardown order read
// backwards. Two things follow from it, both of them load-bearing and both of them bugs that were
// measured on this install rather than reasoned about:
//
//   - Nothing that others depend on may close in its own position. `DataConnectionsModule` at the
//     end is the whole of that today: the pools have to outlive every module that writes during its
//     own teardown.
//   - No hook may cost the ones after it their teardown, or the process its exit. That is
//     `withBoundedShutdown` at the bottom of this file.
const ordered: ServerKitModule[] = [
    // First, and it depends on nothing: a probe asking whether this process is up
    // while everything below is still starting wants the true answer rather than a
    // 404 that reads as a wrong URL. It registers one singleton and starts nothing.
    HealthModule,
    DataModule,
    CryptoModule,
    AuthenticationModule,
    PermissionsModule,
    PolicyModule,
    JobsModule,
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
    // phrasings underneath them. Nothing here reaches forward into either, and it
    // owns no loop — its ready() seeds a station that has no personas at all.
    PersonasModule,
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
    // After DirectorModule, which is the last module that produces events. The
    // position matters less here than anywhere else in this list: it starts
    // nothing and nothing resolves it during another module's start() or
    // ready(), so the modules above may write events without a cycle.
    ActivityModule,
    // After PluginsModule for the same reason as PlaylistsModule: it fans a
    // track out across every enrichment plugin through the registry and the
    // invoker. It also writes catalog rows, but through its own repository, so
    // it does not need CatalogModule.
    EnrichmentModule,
    // Registers nothing and starts nothing: it exists to close the database and Redis at the END,
    // because shutdown runs in this list's order and DataModule has to be at the front of it. With
    // the close still up there, every module below tore down against a pool that had already gone —
    // and the director's flush of the running order, which is a guarantee rather than a nicety, was
    // lost on nine of the shutdowns in this install's log. See DataConnectionsModule.
    DataConnectionsModule,
    // Must stay last: its shutdown hook closes the process-level RotatingLogStore,
    // and every other module's shutdown logging has to be flushed through
    // FileTeeLogger before that happens — including the two lines directly above.
    LoggingModule,
];

/**
 * The list as ServerKit gets it: same modules, same order, with every teardown bounded.
 *
 * Applied here rather than inside each hook because the guarantee is about the LIST — no module may
 * cost the ones after it their teardown, and none may cost the process its exit. A module added
 * later gets it without knowing about it.
 */
export const modules: ServerKitModule[] = ordered.map(module => withBoundedShutdown(module));
