import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { LyricsRepository } from './lyrics.repository.js';
import { LyricsService } from './lyrics.service.js';

/**
 * The words of the station's records, which it reads and never says.
 *
 * No loop and no hooks: the walk is a cron job, and everything else here is resolved by whoever
 * reads a record's timings or labels. Scoped, as the enrichment services beside it are, because the
 * job runner gives every run its own scope.
 */
export const LyricsModule: ServerKitModule = {
    name: 'Lyrics',
    setup: async (registry: Registry, _: AppConfig) => {
        registry.register(LyricsService).useClass(LyricsService).asScoped();
        registry.register(LyricsRepository).useClass(LyricsRepository).asScoped();
    },
};
