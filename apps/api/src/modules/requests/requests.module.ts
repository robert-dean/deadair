import { Container, Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { RequestAiredWatch } from './request.aired.watch.js';
import { RequestDesk } from './request.desk.js';
import { RequestsRepository } from './requests.repository.js';
import { RequestsService } from './requests.service.js';

/**
 * Listener requests: a record somebody asked for, from a listener app or a chat platform.
 *
 * After `DirectorModule`, which places a request, and `NowPlayingModule` and `PlayoutModule`, which
 * say whether the station is on air and when a record is heard. Before `MessagingModule`, whose
 * `/request` command calls the desk here. See `docs/internals/messaging.md` § "Requests".
 *
 * One listener, on the rundown's aired edge, started in `ready`. The retries are a cron, which the
 * job broker owns.
 */
export const RequestsModule: ServerKitModule = {
    name: 'Requests',
    setup: async (registry: Registry, _: AppConfig) => {
        registry.register(RequestsRepository).useClass(RequestsRepository).asScoped();
        registry.register(RequestDesk).useClass(RequestDesk).asScoped();
        registry.register(RequestsService).useClass(RequestsService).asScoped();
        registry.register(RequestAiredWatch).useClass(RequestAiredWatch).asSingleton();
        // `RequestsTickJob` is registered by `JobsModule`, which walks `JobMappings`, like every job.
    },

    ready: async (container: Container, signal: AbortSignal) => {
        if (signal.aborted) return;
        container.get(RequestAiredWatch).start();
    },

    shutdown: async (container: Container) => {
        container.get(RequestAiredWatch).stop();
    },
};
