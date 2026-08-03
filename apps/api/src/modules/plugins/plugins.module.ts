import { Container, Registry } from 'injectkit';
import type { ClientConfig } from 'pg';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { Logger } from '@maroonedsoftware/logger';
import { EnrichmentChain } from './enrichment.chain.js';
import { MusicProviderResolver } from './music.provider.resolver.js';
import { PluginConfigRepository } from './plugin.config.repository.js';
import { PluginConfigService } from './plugin.config.service.js';
import { PluginEchoTracker } from './plugin.echo.tracker.js';
import { PluginHostFactory, PluginHostFactoryOptions } from './plugin.host.factory.js';
import { PluginInvoker } from './plugin.invoker.js';
import { PluginLifecycleManager } from './plugin.lifecycle.manager.js';
import { PluginLoader, PluginLoaderOptions } from './plugin.loader.js';
import { PluginOAuthStateStore } from './plugin.oauth.state.store.js';
import { PluginRegistry } from './plugin.registry.js';
import { PluginReloadListener, PluginReloadListenerOptions } from './plugin.reload.listener.js';
import { PluginStorageRepository } from './plugin.storage.repository.js';
import { bundledPluginDirs } from './plugins.bundled.js';
import { PluginsService } from './plugins.service.js';

/** Where operator-installed plugins are mounted when `PLUGINS_DIR` is unset. */
const DEFAULT_PLUGINS_DIR = './data/plugins';

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * An optional env value. `AppConfig.getString` returns the literal string
 * "undefined" for an absent key (and throws in some configurations), so both
 * outcomes fall back.
 */
const optionalString = (config: AppConfig, key: string): string | undefined => {
    let value: string;
    try {
        value = config.getString(key);
    } catch {
        return undefined;
    }
    return value && value !== 'undefined' ? value : undefined;
};

/**
 * The plugin subsystem.
 *
 * Registered last, because plugins are the layer that sits on top of every
 * other one: a plugin's host reaches the database, the encryption provider and
 * the logger, and nothing in the chassis reaches back.
 *
 * The lifecycle is deliberately split across the hooks. Discovery runs in
 * `start` (it is disk-only and the HTTP surface needs the catalogue populated
 * before it serves a request), while instantiation runs in `ready` because
 * `init` is where a plugin talks to its upstream: an unreachable Spotify must
 * delay nothing and fail nobody but itself.
 */
export const PluginsModule: ServerKitModule = {
    name: 'Plugins',
    setup: async (registry: Registry, config: AppConfig) => {
        const pluginsDir = optionalString(config, 'PLUGINS_DIR') ?? DEFAULT_PLUGINS_DIR;

        registry
            .register(PluginLoaderOptions)
            .useFactory(() => new PluginLoaderOptions(pluginsDir, bundledPluginDirs))
            .asSingleton();
        registry.register(PluginLoader).useClass(PluginLoader).asSingleton();

        // Singleton by necessity, not convenience: the registry IS the host's
        // record of what is running, and a per-scope copy would hand each
        // request a different (empty) view of the world.
        registry.register(PluginRegistry).useClass(PluginRegistry).asSingleton();

        // Likewise the invoker, whose circuit breaker only means anything if
        // every caller shares the same failure counts.
        registry.register(PluginInvoker).useClass(PluginInvoker).asSingleton();

        // And the echo tracker: the writer that announces a `plugin_configs`
        // write (a scoped service, on a request scope that is gone by the time
        // the notification lands) and the listener that consumes it have to be
        // looking at the same map.
        registry.register(PluginEchoTracker).useClass(PluginEchoTracker).asSingleton();

        // And the OAuth state store: the authorize request and the callback that
        // redeems its state are two different requests, so a scoped instance
        // would mint the state into a map that is gone before it comes back.
        registry.register(PluginOAuthStateStore).useClass(PluginOAuthStateStore).asSingleton();

        registry.register(PluginConfigRepository).useClass(PluginConfigRepository).asScoped();
        registry.register(PluginStorageRepository).useClass(PluginStorageRepository).asScoped();
        registry.register(PluginConfigService).useClass(PluginConfigService).asScoped();
        registry.register(PluginsService).useClass(PluginsService).asScoped();

        registry
            .register(PluginHostFactoryOptions)
            .useFactory(() => new PluginHostFactoryOptions(config.getString('APP_BASE_URL')))
            .asSingleton();
        registry.register(PluginHostFactory).useClass(PluginHostFactory).asSingleton();

        registry.register(PluginLifecycleManager).useClass(PluginLifecycleManager).asSingleton();

        // The listener's own connection, built from the same env DataModule's
        // pool uses. LISTEN holds a connection for its whole lifetime, so it
        // cannot come from the query pool.
        const appUser = optionalString(config, 'DATABASE_APP_USER');
        const listenerConnection: ClientConfig = {
            host: config.getString('DATABASE_HOST'),
            port: config.getNumber('DATABASE_PORT'),
            database: config.getString('DATABASE_NAME'),
            user: appUser ?? config.getString('DATABASE_USER'),
            password: appUser ? config.getString('DATABASE_APP_PASSWORD') : config.getString('DATABASE_PASSWORD'),
        };
        registry
            .register(PluginReloadListenerOptions)
            .useFactory(() => new PluginReloadListenerOptions(listenerConnection))
            .asSingleton();
        registry.register(PluginReloadListener).useClass(PluginReloadListener).asSingleton();

        registry.register(MusicProviderResolver).useClass(MusicProviderResolver).asScoped();
        // Singleton so its single-flight map is actually shared between the
        // callers that would otherwise duplicate a fan-out.
        registry.register(EnrichmentChain).useClass(EnrichmentChain).asSingleton();
    },

    start: async (container: Container, signal: AbortSignal) => {
        if (signal.aborted) return;
        const logger = container.get(Logger);
        try {
            await container.get(PluginLifecycleManager).discoverAll();
        } catch (error) {
            logger.error('plugin discovery failed; continuing without plugins', { error: errorText(error) });
        }
    },

    ready: async (container: Container, signal: AbortSignal) => {
        if (signal.aborted) return;
        const logger = container.get(Logger);

        try {
            await container.get(PluginLifecycleManager).initAllEnabled();
        } catch (error) {
            logger.error('plugin initialization failed', { error: errorText(error) });
        }

        if (signal.aborted) return;

        try {
            await container.get(PluginReloadListener).start();
        } catch (error) {
            // Losing the listener costs live config reloads, not the server.
            logger.error('plugin reload listener could not start; config changes will need a restart', { error: errorText(error) });
        }
    },

    shutdown: async (container: Container) => {
        const logger = container.get(Logger);

        try {
            await container.get(PluginReloadListener).stop();
        } catch (error) {
            logger.warn('plugin reload listener did not stop cleanly', { error: errorText(error) });
        }

        try {
            await container.get(PluginLifecycleManager).disposeAll();
        } catch (error) {
            logger.warn('plugins did not dispose cleanly', { error: errorText(error) });
        }
    },
};
