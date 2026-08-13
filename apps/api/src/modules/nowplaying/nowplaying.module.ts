import { Container, Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { StreamService } from '#modules/stream/stream.service.js';
import { inScope } from '#modules/shared/scoped.work.js';
import { NowPlayingService } from './nowplaying.service.js';

/**
 * The station's public answer to "what are you playing".
 *
 * Registered after PlayoutModule, whose singleton `Rundown` holds what is on
 * air, and after StreamModule, which owns the station's name. It starts nothing
 * and stores nothing: everything it reports is already being kept by somebody
 * else.
 */
export const NowPlayingModule: ServerKitModule = {
    name: 'NowPlaying',
    setup: async (registry: Registry, _: AppConfig) => {
        // Singleton, unlike most request-facing services here, and for the reason
        // documented on the class: it answers a public poll out of memory, so it
        // holds the station name rather than reading a scoped repository per call.
        registry.register(NowPlayingService).useClass(NowPlayingService).asSingleton();
    },

    ready: async (container: Container, signal: AbortSignal) => {
        if (signal.aborted) return;

        // Read once, the same way PlayoutModule reads the bridge secret: this is on a
        // route a device may poll every few seconds, and the settings sit behind a
        // scoped repository.
        await inScope(container, async scope => {
            const { title } = await scope.get(StreamService).settings();
            container.get(NowPlayingService).useStationName(title);
        });
    },
};
