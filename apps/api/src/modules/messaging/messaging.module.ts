import { Container, Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { MessagingCommands } from './messaging.commands.js';
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
 * It owns one loop, the poller, started in `ready` because nobody's first request depends on it.
 */
export const MessagingModule: ServerKitModule = {
    name: 'Messaging',
    setup: async (registry: Registry, _: AppConfig) => {
        // Singletons, because the poller that drives them runs off the request path. The repository
        // is scoped like every other, and reached through `inScope`.
        registry.register(MessagingService).useClass(MessagingService).asSingleton();
        registry.register(MessagingCommands).useClass(MessagingCommands).asSingleton();
        registry.register(MessagingPoller).useClass(MessagingPoller).asSingleton();
        registry.register(MessagingRepository).useClass(MessagingRepository).asScoped();
    },

    ready: async (container: Container, signal: AbortSignal) => {
        if (signal.aborted) return;
        container.get(MessagingPoller).start();
    },

    shutdown: async (container: Container) => {
        await container.get(MessagingPoller).stop();
    },
};
