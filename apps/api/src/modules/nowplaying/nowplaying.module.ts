import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { NowPlayingService } from './nowplaying.service.js';

/**
 * The station's public answer to "what are you playing".
 *
 * Registered after PlayoutModule, whose singleton `Rundown` holds what is on
 * air. It starts nothing and stores nothing: everything it reports is already
 * being kept by somebody else, or read straight off `AppConfig`.
 */
export const NowPlayingModule: ServerKitModule = {
    name: 'NowPlaying',
    setup: async (registry: Registry, _: AppConfig) => {
        // Singleton, unlike most request-facing services here, and for the reason
        // documented on the class: it answers a public poll out of memory, needing
        // no DI scope to read either the rundown or the settings.
        registry.register(NowPlayingService).useClass(NowPlayingService).asSingleton();
    },
};
