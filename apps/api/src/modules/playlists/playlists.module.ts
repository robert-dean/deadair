import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { PlaylistsService } from './playlists.service.js';
import { PlaylistImportPlanner } from './playlist.import.planner.js';
import { PlaylistImportService } from './playlist.import.service.js';
import { PlaylistFillService } from './playlist.fill.service.js';
import { StationPlaylistsRepository } from './station.playlists.repository.js';
import { StationPlaylistsService } from './station.playlists.service.js';

export const PlaylistsModule: ServerKitModule = {
    name: 'Playlists',
    setup: async (registry: Registry, _: AppConfig) => {
        // Scoped: it depends on the scoped `AccessControlService`.
        registry.register(PlaylistsService).useClass(PlaylistsService).asScoped();
        // The playlists the station owns. Scoped, because the planner reads through the catalog's
        // scoped resolver and every write joins the request's transaction.
        registry.register(StationPlaylistsRepository).useClass(StationPlaylistsRepository).asScoped();
        registry.register(PlaylistImportPlanner).useClass(PlaylistImportPlanner).asScoped();
        registry.register(StationPlaylistsService).useClass(StationPlaylistsService).asScoped();
        registry.register(PlaylistImportService).useClass(PlaylistImportService).asScoped();
        registry.register(PlaylistFillService).useClass(PlaylistFillService).asScoped();
    },
};
