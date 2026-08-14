import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { HealthService } from './health.service.js';

/**
 * Liveness.
 *
 * First in the list because it depends on nothing and must keep answering while
 * everything below it is still starting: a probe asking whether the process is
 * up during boot wants the true answer, not a 404 that reads as a wrong URL.
 * It starts no loop, holds no connection and has nothing to tear down, so its
 * position in the shutdown walk (which runs in this same order) is free.
 */
export const HealthModule: ServerKitModule = {
    name: 'Health',
    setup: async (registry: Registry, _: AppConfig) => {
        // Singleton for the reason NowPlayingService is one: it answers a poll out of
        // memory, so there is nothing per-request about it and no scope to pay for.
        registry.register(HealthService).useClass(HealthService).asSingleton();
    },
};
