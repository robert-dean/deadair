import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { PlaylistsService } from './playlists.service.js';

export const PlaylistsModule: ServerKitModule = {
    name: 'Playlists',
    setup: async (registry: Registry, _: AppConfig) => {
        // Scoped: it depends on the scoped `AccessControlService`.
        registry.register(PlaylistsService).useClass(PlaylistsService).asScoped();
    },
};
