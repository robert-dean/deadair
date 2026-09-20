import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { StorageRepository } from './storage.repository.js';
import { StorageService } from './storage.service.js';

/**
 * How much disk the station is using, and for what.
 *
 * Four content stores share one volume — records, cover art, the audio of everything the station has
 * said, and the voice previews — and each belongs to a module that is right not to know what the
 * others hold. A volume filling up is a fact about the machine rather than about any of them, so it
 * gets a reader of its own instead of one of them growing a method about disks in general.
 *
 * ## Where it sits
 *
 * After `ArtModule`, `RenderModule` and `PlayoutModule`, because it resolves the stores those three
 * register. Nothing depends on it in turn: it registers a repository and a request-path service,
 * owns no loop, starts nothing, and is resolved only by a request. So its position is a dependency
 * order and not a lifecycle one, and shutting down in the same place costs nothing.
 *
 * ## Reading never repairs, and the repair is off
 *
 * `GET /storage` deletes nothing and never will. `SweepOrphansJob` does, nightly, for files no row
 * claims and nothing is still writing — and only once an operator turns it on, which no upgrade
 * does for them. The numbers had to exist before anything acted on them and they did, for a month
 * before this could. A row whose file has gone is still left alone: the station heals that one by
 * re-fetching. See {@link StorageService}.
 */
export const StorageModule: ServerKitModule = {
    name: 'Storage',
    setup: async (registry: Registry) => {
        registry.register(StorageRepository).useClass(StorageRepository).asScoped();
        registry.register(StorageService).useClass(StorageService).asScoped();
    },
};
