import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { RatingAnnouncer } from './rating.announce.js';
import { ArtistsService } from './artists.service.js';
import { AlbumsService } from './albums.service.js';
import { TracksService } from './tracks.service.js';
import { ArtistsRepository } from './artists.repository.js';
import { AlbumsRepository } from './albums.repository.js';
import { TracksRepository } from './tracks.repository.js';
import { TasteRepository } from './taste.repository.js';
import { HiddenPlaylistsRepository } from './hidden.playlists.repository.js';
import { CatalogPlaceholderRepository } from './ingest/catalog.placeholder.repository.js';
import { CatalogPlaceholderService } from './ingest/catalog.placeholder.service.js';
import { CatalogResolverRepository } from './ingest/catalog.resolver.repository.js';
import { CatalogResolverService } from './ingest/catalog.resolver.service.js';
import { CatalogSyncService } from './ingest/catalog.sync.service.js';

export const CatalogModule: ServerKitModule = {
    name: 'Catalog',
    setup: async (registry: Registry, _: AppConfig) => {
        // What the three rate methods tell the station once their write is durable. Scoped like
        // them, because it is `AfterCommit` — itself scoped, one list of tasks per request — that
        // it defers onto.
        registry.register(RatingAnnouncer).useClass(RatingAnnouncer).asScoped();
        registry.register(ArtistsService).useClass(ArtistsService).asScoped();
        registry.register(ArtistsRepository).useClass(ArtistsRepository).asScoped();
        registry.register(AlbumsService).useClass(AlbumsService).asScoped();
        registry.register(AlbumsRepository).useClass(AlbumsRepository).asScoped();
        registry.register(TracksService).useClass(TracksService).asScoped();
        registry.register(TracksRepository).useClass(TracksRepository).asScoped();
        // Read by the director's prompt builder and by the model's own tool, which is why it lives
        // here rather than in either of them: the two ask the same question for different reasons,
        // and two spellings of "what has the operator rated" would eventually disagree.
        registry.register(TasteRepository).useClass(TasteRepository).asScoped();
        // The provider playlists an operator hid. Here rather than in `PlaylistsModule` because the
        // sync below skips them too, and this module registers first.
        registry.register(HiddenPlaylistsRepository).useClass(HiddenPlaylistsRepository).asScoped();

        // `ingest/` — writes, as opposed to the read side above. Scoped like
        // its siblings: the job runner gives every execution its own scope, so
        // these are per-run there and per-request on the request path.
        registry.register(CatalogResolverRepository).useClass(CatalogResolverRepository).asScoped();
        registry.register(CatalogResolverService).useClass(CatalogResolverService).asScoped();
        registry.register(CatalogSyncService).useClass(CatalogSyncService).asScoped();
        registry.register(CatalogPlaceholderRepository).useClass(CatalogPlaceholderRepository).asScoped();
        registry.register(CatalogPlaceholderService).useClass(CatalogPlaceholderService).asScoped();
    },
};
