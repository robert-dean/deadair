import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { buildRevision } from '#modules/shared/build.revision.js';
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
    setup: async (registry: Registry, config: AppConfig) => {
        // Singleton for the reason NowPlayingService is one: it answers a poll out of
        // memory, so there is nothing per-request about it and no scope to pay for.
        //
        // A factory rather than `useClass` only so the build revision can be resolved HERE,
        // once, and handed over as a string. The alternative — injecting `AppConfig` into the
        // service — would give a liveness probe a live config read per call and would put a
        // dependency on the one service in the tree whose whole claim is that it has none.
        registry
            .register(HealthService)
            .useFactory(() => new HealthService(buildRevision(config)))
            .asSingleton();
    },
};
