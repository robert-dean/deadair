import { Container, Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { MessagingAnnouncer } from './messaging.announcer.js';
import { MessagingCommands } from './messaging.commands.js';
import { MessagingLinksService } from './messaging.links.service.js';
import { MessagingOperator } from './messaging.operator.js';
import { MessagingRequests } from './messaging.requests.js';
import { MessagingPoller } from './messaging.poller.js';
import { MessagingRepository } from './messaging.repository.js';
import { MessagingService } from './messaging.service.js';

/**
 * The station on chat platforms: Telegram, and whatever else a `messaging` plugin connects.
 *
 * After `PluginsModule`, whose registry it reads, and after `NowPlayingModule` and `DirectorModule`,
 * which is what people on a chat platform ask about and, through commands, act on. Late in the list
 * so it tears down EARLY: the poller lets go of every platform before the director flushes the running
 * order and long before the plugins it polls are disposed.
 *
 * It owns one loop, the poller, and one listener, the announcer on the rundown's aired edge. Both
 * start in `ready`, because nobody's first request depends on either.
 */
export const MessagingModule: ServerKitModule = {
    name: 'Messaging',
    setup: async (registry: Registry, _: AppConfig) => {
        // Singletons, because the poller that drives them runs off the request path. The repository
        // is scoped like every other, and reached through `inScope`.
        registry.register(MessagingService).useClass(MessagingService).asSingleton();
        registry.register(MessagingCommands).useClass(MessagingCommands).asSingleton();
        registry.register(MessagingPoller).useClass(MessagingPoller).asSingleton();
        registry.register(MessagingAnnouncer).useClass(MessagingAnnouncer).asSingleton();
        // `MessagingAnnounceJob` is registered by `JobsModule`, which walks `JobMappings`, like every job.
        registry.register(MessagingOperator).useClass(MessagingOperator).asSingleton();
        registry.register(MessagingRequests).useClass(MessagingRequests).asSingleton();
        registry.register(MessagingRepository).useClass(MessagingRepository).asScoped();
        // Scoped: it answers the console's routes and reads the request's actor.
        registry.register(MessagingLinksService).useClass(MessagingLinksService).asScoped();
    },

    ready: async (container: Container, signal: AbortSignal) => {
        if (signal.aborted) return;
        container.get(MessagingPoller).start();
        container.get(MessagingAnnouncer).start();
    },

    shutdown: async (container: Container) => {
        container.get(MessagingAnnouncer).stop();
        await container.get(MessagingPoller).stop();
    },
};
