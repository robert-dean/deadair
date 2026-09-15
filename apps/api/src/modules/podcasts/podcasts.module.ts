import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { PodcastEpisodeRepository } from './podcast.episode.repository.js';
import { PodcastFetchOptions, PodcastFetchService } from './podcast.fetch.service.js';
import { PodcastsService } from './podcasts.service.js';
import { PodcastScheduler } from './podcast.scheduler.js';
import { SyndicatedSource } from './syndicated.source.js';

/**
 * Somebody else's programmes, out of whatever podcast plugins are installed, and the station's record
 * of which episodes it knows about and what it has done with each.
 *
 * Registered after `PluginsModule` for the reason `NewsModule` is: everything here resolves
 * `PluginRegistry` and `PluginInvoker`, and a module that reads the registry before it exists finds an
 * empty one rather than an error.
 *
 * It starts nothing and owns no loop. Feeds are re-read by a cron job (`podcasts.refresh`), which the
 * jobs module runs, and nothing here polls.
 */
export const PodcastsModule: ServerKitModule = {
    name: 'Podcasts',
    setup: async (registry: Registry, _: AppConfig) => {
        // Scoped with the plugin registry and invoker they read, like every other capability consumer.
        registry.register(PodcastEpisodeRepository).useClass(PodcastEpisodeRepository).asScoped();
        registry.register(PodcastsService).useClass(PodcastsService).asScoped();
        // The real network: the platform's fetch and the system resolver. A singleton, since it is two
        // functions and nothing else.
        registry
            .register(PodcastFetchOptions)
            .useFactory(() => new PodcastFetchOptions())
            .asSingleton();
        registry.register(PodcastFetchService).useClass(PodcastFetchService).asScoped();
        // The clock's two halves: what a `syndicated` band carries, and the fetch ahead of it. Scoped,
        // and resolved by the director's commit pass through a scope of its own, as the production
        // scheduler is.
        registry.register(SyndicatedSource).useClass(SyndicatedSource).asScoped();
        registry.register(PodcastScheduler).useClass(PodcastScheduler).asScoped();
    },
};
