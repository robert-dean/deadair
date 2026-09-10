import { Container, Registry } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { Logger } from '@maroonedsoftware/logger';
import { getLogStore } from '#src/logging/log.store.js';
import { RotatingLogStore } from '#src/logging/rotating.log.store.js';
import { PluginConfigRepository } from './plugin.config.repository.js';
import { PluginConfigService } from './plugin.config.service.js';
import { PluginHostFactory, PluginHostFactoryOptions } from './plugin.host.factory.js';
import { PluginInvoker } from './plugin.invoker.js';
import { PluginLifecycleManager } from './plugin.lifecycle.manager.js';
import { PluginLoader, PluginLoaderOptions } from './plugin.loader.js';
import { PluginLog, PluginLogOptions } from './plugin.log.js';
import { PluginGrantsRepository } from './plugin.grants.repository.js';
import { PluginGrantsService } from './plugin.grants.service.js';
import { PluginOAuthStateStore } from './plugin.oauth.state.store.js';
import { PluginRegistry } from './plugin.registry.js';
import { PluginStorageRepository } from './plugin.storage.repository.js';
import { bundledPluginDirs } from './plugins.bundled.js';
import { PluginsService } from './plugins.service.js';
import { PluginLogLevel } from './types/plugins.types.js';
import { errorText } from '#modules/shared/error.text.js';

/** Where operator-installed plugins are mounted when `PLUGINS_DIR` is unset. */
const DEFAULT_PLUGINS_DIR = './data/plugins';

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
        const pluginsDir = config.get('PLUGINS_DIR', DEFAULT_PLUGINS_DIR);

        // `setup.server.ts` builds the one `RotatingLogStore` for the process, before this
        // (or any) container exists, and stashes it in the process-level holder because
        // `ServerKitModule.setup` has no way to receive it directly. Reaching for a fresh
        // `new RotatingLogStore(...)` here instead would open a second writable stream onto
        // the same channel files: two independent size counters, two rotations racing each
        // other. If this ever fires it means a module ran ahead of server setup, which is a
        // startup-order bug worth failing loudly for rather than quietly doubling the store.
        const logStore = getLogStore();
        if (!logStore) {
            throw new Error('PluginsModule.setup: no RotatingLogStore set; setup.server.ts must call setLogStore first');
        }

        const rawPluginLogLevel = config.get('PLUGIN_LOG_LEVEL', 'info');
        const pluginLogLevelResult = PluginLogLevel.safeParse(rawPluginLogLevel);
        const defaultPluginLogLevel = pluginLogLevelResult.success ? pluginLogLevelResult.data : 'info';

        registry
            .register(PluginLoaderOptions)
            .useFactory(() => new PluginLoaderOptions(pluginsDir, bundledPluginDirs))
            .asSingleton();
        registry.register(PluginLoader).useClass(PluginLoader).asSingleton();

        // Singleton by necessity, not convenience: the registry IS the host's
        // record of what is running, and a per-scope copy would hand each
        // request a different (empty) view of the world.
        registry.register(PluginRegistry).useClass(PluginRegistry).asSingleton();

        // Singleton for the same reason PluginRegistry is: it fronts the process-wide
        // `RotatingLogStore` (a `Map<channel, WriteStream>`), and its writers below
        // (PluginInvoker, PluginHostFactory, PluginLifecycleManager) are all singletons
        // themselves, so a scoped copy would just be a second, empty view of a stream
        // map the request never owns.
        registry
            .register(PluginLogOptions)
            .useFactory(() => new PluginLogOptions(defaultPluginLogLevel))
            .asSingleton();
        registry
            .register(RotatingLogStore)
            .useFactory(() => logStore)
            .asSingleton();
        registry.register(PluginLog).useClass(PluginLog).asSingleton();

        // Likewise the invoker, whose circuit breaker only means anything if
        // every caller shares the same failure counts.
        registry.register(PluginInvoker).useClass(PluginInvoker).asSingleton();

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
            .useFactory(() => new PluginHostFactoryOptions(config.get('APP_BASE_URL', '')))
            .asSingleton();
        // Scoped like every other repository, and reached through `inScope` by the
        // singleton below it: what the host asks on every fetch is an in-memory
        // map, and this table is only what that map is built from.
        registry.register(PluginGrantsRepository).useClass(PluginGrantsRepository).asScoped();

        // Singletons that read the scoped registrations above, and therefore
        // inject `Container` and open a scope per call rather than holding one of
        // them. A singleton holding a scoped service is a captive dependency the
        // container rejects at `build()`, and the reason it rejects it is exactly
        // what these would do with a request's transaction: keep using it after
        // the request that opened it had committed.
        registry.register(PluginGrantsService).useClass(PluginGrantsService).asSingleton();
        registry.register(PluginHostFactory).useClass(PluginHostFactory).asSingleton();

        registry.register(PluginLifecycleManager).useClass(PluginLifecycleManager).asSingleton();
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

        // Before anything is initialized, because `init` is where a plugin first talks to its
        // upstream and a grant read afterwards would be read after the first fetch that needed it.
        // A failure here leaves the map empty, which refuses every capability: a host that cannot
        // read what it granted should not be granting, and the cost is a plugin doing the job it
        // can do without one.
        try {
            await container.get(PluginGrantsService).refresh();
        } catch (error) {
            logger.error('plugin grants could not be read; every capability stays refused', { error: errorText(error) });
        }

        try {
            await container.get(PluginLifecycleManager).initAllEnabled();
        } catch (error) {
            logger.error('plugin initialization failed', { error: errorText(error) });
        }
    },

    shutdown: async (container: Container) => {
        const logger = container.get(Logger);

        // First, so a quarantined plugin's recovery timer cannot start a probe against an instance
        // the next line is disposing. Synchronous and cannot throw.
        container.get(PluginInvoker).stopRecovery();

        try {
            await container.get(PluginLifecycleManager).disposeAll();
        } catch (error) {
            logger.warn('plugins did not dispose cleanly', { error: errorText(error) });
        }
    },
};
