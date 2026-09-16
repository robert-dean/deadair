import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { NarrationPieceRepository } from './narration.piece.repository.js';
import { NarrationScheduler } from './narration.scheduler.js';
import { NarrationSource } from './narration.source.js';
import { NarrationsService } from './narrations.service.js';

/**
 * What the station reads out in its own voice, out of whatever narration plugins are installed, and
 * the station's record of which pieces it knows about and what it has done with each.
 *
 * Registered after `PluginsModule` for the reason `PodcastsModule` is: everything here resolves
 * `PluginRegistry` and `PluginInvoker`, and a module that reads the registry before it exists finds
 * an empty one rather than an error. And before `TopicsModule`, because it owns the `narration` topic
 * kind and the kind's owner registers ahead of the registry listing them.
 *
 * It starts nothing and owns no loop. Series are re-read by a cron job (`narrations.refresh`), which
 * the jobs module runs, and nothing here polls.
 */
export const NarrationsModule: ServerKitModule = {
    name: 'Narrations',
    setup: async (registry: Registry, _: AppConfig) => {
        // Scoped with the plugin registry and invoker they read, like every other capability consumer.
        registry.register(NarrationPieceRepository).useClass(NarrationPieceRepository).asScoped();
        registry.register(NarrationsService).useClass(NarrationsService).asScoped();
        // The clock's two halves: what a `narration` band reads, and making it ahead of the slot.
        // Scoped, and resolved by the director's commit pass through a scope of its own, as the
        // podcast scheduler is.
        registry.register(NarrationSource).useClass(NarrationSource).asScoped();
        registry.register(NarrationScheduler).useClass(NarrationScheduler).asScoped();
    },
};
