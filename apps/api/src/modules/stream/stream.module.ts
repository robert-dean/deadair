import { Container, Registry } from 'injectkit';
import { AppConfig, AppConfigStore } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { IcecastStatsClient } from './icecast.stats.client.js';
import { SpotifyShimClient } from './spotify.shim.client.js';
import { StreamService } from './stream.service.js';

/**
 * The stream's configuration, materialized for containers that cannot read the
 * database.
 *
 * Renders in `ready`, not `start`: it touches the database and a shared volume,
 * and nothing serving a request depends on it having finished. A failure here
 * costs the containers their newest config, not the app its socket.
 *
 * `deadair_settings_changed` is listened to, but by the app's config store and
 * not by this module, and the difference is the point: a settings change reaches
 * `StreamService.settings()` on its own, and re-rendering on it would still not
 * be heard, because Icecast and Liquidsoap read their config once at startup. So
 * a `stream.*` change means a container restart either way, and anything that
 * grows into a second writer of those settings calls
 * {@link StreamService.materialize} itself.
 */
export const StreamModule: ServerKitModule = {
    name: 'Stream',
    setup: async (registry: Registry, _config: AppConfig) => {
        // Scoped: it depends on the scoped `SettingsRepository` and `EncryptionProvider`.
        registry.register(StreamService).useClass(StreamService).asScoped();

        // Singleton, and holds the two stream secrets pushed into it at `ready`:
        // it is reached from `PluginHostFactory`, which is itself a singleton
        // built long before any request scope exists.
        registry.register(SpotifyShimClient).useClass(SpotifyShimClient).asSingleton();

        // Singleton for the same reason, and holding the same kind of state: the mount
        // and its address are pushed in at `ready`, and the poll loop that reads them
        // (`AudienceWatch`) is itself a singleton with no request scope to borrow.
        registry.register(IcecastStatsClient).useClass(IcecastStatsClient).asSingleton();
    },

    ready: async (container: Container, signal: AbortSignal) => {
        if (signal.aborted) return;
        const logger = container.get(Logger);

        // A scope of its own: the service and its dependencies are scoped, and this
        // runs outside any request. Disposed at the end so its instances are released
        // rather than living for the process.
        const scope = container.createScopedContainer();
        try {
            const stream = scope.get(StreamService);

            if (await stream.ensureSecrets()) {
                // Everything below reads the settings through the app's CONFIG, whose settings
                // layer was loaded before this seed happened, so without this the first boot of a
                // fresh station would render both containers' configs with no passwords in them
                // and hand the shim an empty pair. Awaited inline rather than deferred, which is
                // safe here and nowhere in a request: `ready` runs outside the one-transaction-per
                // -request middleware, so these writes are already committed.
                await container.get(AppConfigStore).reload();
                logger.info('stream: seeded the missing stream secrets; restart icecast and liquidsoap once to adopt them');
            }
            await stream.materialize();

            // After the seed, so a first boot hands over the secrets it just wrote
            // rather than the empty pair it read a moment earlier.
            const settings = stream.settings();
            const { playoutBridgeSecret, spotifyShimSecret } = settings;
            container.get(SpotifyShimClient).useSecrets(playoutBridgeSecret ?? '', spotifyShimSecret ?? '');

            // The mount whose listeners are the station's audience, from the same settings
            // the rendered icecast.xml was built from a moment ago — including the admin
            // password, because 2.5 serves the stats document from under `/admin/` and the
            // roles it ships deny anonymous.
            container.get(IcecastStatsClient).useMount({
                host: settings.icecastHost,
                port: settings.icecastPort,
                mount: settings.mount,
                adminPassword: settings.adminPassword,
            });
        } finally {
            await scope.disposeAsync();
        }
    },
};
