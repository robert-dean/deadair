import { Container, Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { EventAnnouncer } from './event.announcer.js';
import { EventDeliverer } from './event.deliverer.js';
import { EventDestinationsRepository } from './event.destinations.repository.js';
import { EventDestinationsService } from './event.destinations.service.js';
import { WebhookSender, WebhookSenderOptions } from './webhook.sender.js';

/**
 * Event destinations: the station telling an operator's own servers what happens on it, as a signed
 * POST per event. See `docs/internals/events.md`.
 *
 * Late in the list, after everything whose moments it will carry (the transport, the director, the
 * requests desk), so it can listen to each of them without any of them knowing it exists, and so it
 * tears down before they do.
 */
export const EventsModule: ServerKitModule = {
    name: 'Events',
    setup: async (registry: Registry, _: AppConfig) => {
        // Singletons: the sender holds no request state, and the delivery job that will call it runs
        // off the request path.
        registry
            .register(WebhookSenderOptions)
            .useFactory(() => new WebhookSenderOptions())
            .asSingleton();
        registry.register(WebhookSender).useClass(WebhookSender).asSingleton();
        registry.register(EventDeliverer).useClass(EventDeliverer).asSingleton();
        registry.register(EventAnnouncer).useClass(EventAnnouncer).asSingleton();
        // `EventsDeliverJob` is registered by `JobsModule`, which walks `JobMappings`, like every job.
        registry.register(EventDestinationsRepository).useClass(EventDestinationsRepository).asScoped();
        // Scoped: it answers the console's routes and reads the request's actor.
        registry.register(EventDestinationsService).useClass(EventDestinationsService).asScoped();
    },

    ready: async (container: Container, signal: AbortSignal) => {
        if (signal.aborted) return;
        container.get(EventAnnouncer).start();
    },

    shutdown: async (container: Container) => {
        container.get(EventAnnouncer).stop();
    },
};
