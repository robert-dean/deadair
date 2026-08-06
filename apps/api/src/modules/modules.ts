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
import { PlayoutModule } from './playout/playout.module.js';
import { EnrichmentModule } from './enrichment/enrichment.module.js';
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
    // After PlaylistsModule: its resolver reaches the plugin registry and invoker
    // for a track's stream URL, and its ready() reads the bridge secret the
    // StreamModule above has already seeded and materialized.
    PlayoutModule,
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
