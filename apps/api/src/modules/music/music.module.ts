import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ArtistsService } from './artists.service.js';
import { AlbumsService } from './albums.service.js';
import { TracksService } from './tracks.service.js';
import { ArtistsRepository } from './artists.repository.js';
import { AlbumsRepository } from './albums.repository.js';
import { TracksRepository } from './tracks.repository.js';

export const MusicModule: ServerKitModule = {
    name: 'Music',
    setup: async (registry: Registry, _: AppConfig) => {
        registry.register(ArtistsService).useClass(ArtistsService).asScoped();
        registry.register(ArtistsRepository).useClass(ArtistsRepository).asScoped();
        registry.register(AlbumsService).useClass(AlbumsService).asScoped();
        registry.register(AlbumsRepository).useClass(AlbumsRepository).asScoped();
        registry.register(TracksService).useClass(TracksService).asScoped();
        registry.register(TracksRepository).useClass(TracksRepository).asScoped();
    },
};
