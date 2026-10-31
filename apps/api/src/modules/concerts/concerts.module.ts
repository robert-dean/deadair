import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ConcertService } from './concert.service.js';

/**
 * When an artist is next nearby, out of whatever concert plugins are installed.
 *
 * Registered after `PluginsModule` and before `DirectorModule`, for `WeatherModule`'s reason. It
 * starts nothing and owns no loop: a date is asked for because a break is being written.
 */
export const ConcertsModule: ServerKitModule = {
    name: 'Concerts',
    setup: async (registry: Registry, _: AppConfig) => {
        registry.register(ConcertService).useClass(ConcertService).asScoped();
    },
};
