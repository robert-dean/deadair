import { ServerKitModule } from '@maroonedsoftware/koa';
import { DataModule } from './data/data.module.js';
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
import { LlmModule } from './llm/llm.module.js';
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

// Registered in dependency order: infrastructure (data, shared, messaging,
// events) first, then the single-actor identity/auth foundation. IdentityModule
// is a list of modules, spread in place. Add your app's domain modules after
// this chassis set.
export const modules: ServerKitModule[] = [
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
    // After PluginsModule for the same reason, and before RenderModule and
    // DirectorModule, which are the two that will ask a model for words. It owns
    // no loop and starts nothing: a generation happens because something asked.
    LlmModule,
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
    // Must stay last: its shutdown hook closes the process-level RotatingLogStore,
    // and every other module's shutdown logging has to be flushed through
    // FileTeeLogger before that happens.
    LoggingModule,
];
