import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ScrobbleRepository } from './scrobble.repository.js';
import { ScrobbleService } from './scrobble.service.js';

/**
 * Telling somebody else what the station played.
 *
 * After `PluginsModule` like every capability consumer, and before
 * `DirectorModule`, which resolves the service on the aired edge.
 *
 * It starts nothing. The queue fills on a track boundary and drains on a cron,
 * and this module owns neither — the boundary belongs to the director and the
 * cron to the job broker.
 */
export const ScrobbleModule: ServerKitModule = {
    name: 'Scrobble',
    setup: async (registry: Registry, _: AppConfig) => {
        // Scoped, like the repositories it writes alongside: the job runner gives
        // every execution its own scope, so these are per-run there and per-request
        // on the request path.
        registry.register(ScrobbleService).useClass(ScrobbleService).asScoped();
        registry.register(ScrobbleRepository).useClass(ScrobbleRepository).asScoped();
    },
};
