import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { HistoryRepository } from './history.repository.js';
import { HistoryService } from './history.service.js';

/**
 * What the station has played, as one list a listener can scroll.
 *
 * It owns nothing. `play_history` is the director's, written from the rundown's `onAired`, and the
 * cover and running time are the catalog's; this module is a read across the two and nothing else.
 * That is the same arrangement `ActivityModule` has with the three tables behind the feed, and it is
 * the reason both can exist without giving any of those tables a second writer.
 *
 * ## Where it sits
 *
 * After `ActivityModule`, whose cursor helpers it reuses, and like it: this module starts nothing,
 * owns no loop, and nothing resolves it during another module's `start()` or `ready()`. Its only
 * caller is the request path, by which point every module is registered.
 */
export const HistoryModule: ServerKitModule = {
    name: 'History',
    setup: async (registry: Registry) => {
        // Scoped, like every other repository and every other request-path service.
        registry.register(HistoryRepository).useClass(HistoryRepository).asScoped();
        registry.register(HistoryService).useClass(HistoryService).asScoped();
    },
};
