import { Container, Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig, AppConfigStore } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { SettingsService } from './settings.service.js';
import { SettingsRepository } from './settings.repository.js';
import { getConfigStore } from '#src/server/config.store.js';
import { errorText } from '#modules/shared/error.text.js';

export const SettingsModule: ServerKitModule = {
    name: 'Settings',
    setup: async (registry: Registry, _: AppConfig) => {
        registry.register(SettingsService).useClass(SettingsService).asScoped();
        registry.register(SettingsRepository).useClass(SettingsRepository).asScoped();

        // The store behind the injected `AppConfig`, reached the same way `PluginsModule` reaches
        // the log store: built in `setup.server.ts` before any container existed, published
        // through a process-wide holder, and registered here so the rest of the app can ask for it
        // by token. What needs the store rather than the config is anything that WRITES a setting,
        // because a write has to be followed by a reload rather than left to race the NOTIFY round
        // trip.
        //
        // Absent in tests that never ran server setup, which is why the factory throws a sentence
        // rather than registering `undefined` and failing later at a property access.
        registry
            .register(AppConfigStore)
            .useFactory(() => {
                const store = getConfigStore();
                if (store === undefined) throw new Error('the app config store is not available: server setup has not run');
                return store;
            })
            .asSingleton();
    },

    shutdown: async (container: Container) => {
        const logger = container.get(Logger);

        try {
            // Tears down the dedicated connection holding `LISTEN deadair_settings_changed`. A
            // listen is bound to a physical backend, so that connection is destroyed rather than
            // returned to anything, and leaving it would hold the process open past its own
            // shutdown.
            getConfigStore()?.dispose();
        } catch (error) {
            logger.warn('settings: the config store did not dispose cleanly', { error: errorText(error) });
        }
    },
};
