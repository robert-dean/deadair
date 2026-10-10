import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { LyricLabelsRepository } from './lyric.labels.repository.js';
import { LyricMoodsService } from './lyric.moods.service.js';
import { LyricSubjectsService } from './lyric.subjects.service.js';
import { LyricsReadService } from './lyrics.read.service.js';
import { LyricsRepository } from './lyrics.repository.js';
import { LyricsService } from './lyrics.service.js';
import { VocalMarkersReader } from './vocal.markers.reader.js';
import { VocalMarkersService } from './vocal.markers.service.js';

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
        // What the station derives from the words, and the walk that derives it.
        registry.register(LyricLabelsRepository).useClass(LyricLabelsRepository).asScoped();
        registry.register(LyricMoodsService).useClass(LyricMoodsService).asScoped();
        registry.register(LyricSubjectsService).useClass(LyricSubjectsService).asScoped();
        // What the director asks: where the singing is on the records it is about to talk over.
        registry.register(VocalMarkersReader).useClass(VocalMarkersReader).asScoped();
        // The operator's side of the same markers, behind `/catalog/tracks/{id}/vocal-markers`.
        registry.register(VocalMarkersService).useClass(VocalMarkersService).asScoped();
        // The words themselves, read-only, behind `/catalog/tracks/{id}/lyrics`.
        registry.register(LyricsReadService).useClass(LyricsReadService).asScoped();
    },
};
