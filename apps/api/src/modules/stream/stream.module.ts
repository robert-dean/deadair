import { Container, Registry } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { StreamService } from './stream.service.js';

/**
 * The stream's configuration, materialized for containers that cannot read the
 * database.
 *
 * Renders in `ready`, not `start`: it touches the database and a shared volume,
 * and nothing serving a request depends on it having finished. A failure here
 * costs the containers their newest config, not the app its socket.
 *
 * There is deliberately no listener on `deadair_settings_changed`. The trigger
 * exists, but a live re-render would only help if the containers re-read their
 * config, and both read it once at startup — so a settings change means a
 * restart either way. Anything that grows into a second writer of the `stream.*`
 * settings calls `StreamService.materialize` itself.
 */
export const StreamModule: ServerKitModule = {
    name: 'Stream',
    setup: async (registry: Registry, _config: AppConfig) => {
        // Scoped: it depends on the scoped `SettingsRepository` and `EncryptionProvider`.
        registry.register(StreamService).useClass(StreamService).asScoped();
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
                logger.info('stream: seeded the missing stream secrets; restart icecast and liquidsoap once to adopt them');
            }
            await stream.materialize();
        } finally {
            await scope.disposeAsync();
        }
    },
};
