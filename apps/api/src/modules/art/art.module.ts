import { Registry } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { ArtRepository } from './art.repository.js';
import { ArtStore } from './art.store.js';

/** Where cached art is written when `ART_DIR` is unset. Alongside `logs/`, and gitignored with it. */
const DEFAULT_ART_DIR = './media/art';

/**
 * Locally cached artwork: the files, and the rows that say what is in them.
 *
 * Registered before the catalog because catalog reads join `art_assets` to hand out a local URL in
 * place of the upstream one, and nothing here reaches back into the catalog.
 */
export const ArtModule: ServerKitModule = {
    name: 'Art',
    setup: async (registry: Registry, config: AppConfig) => {
        // Singleton: it is a directory root and nothing else, so a per-request copy would be a
        // per-request re-read of the same string.
        registry
            .register(ArtStore)
            .useFactory(() => new ArtStore(config.get('ART_DIR', DEFAULT_ART_DIR)))
            .asSingleton();

        // Scoped, like every other repository: per-request on the request path, per-run in the job
        // the sweeper executes as.
        registry.register(ArtRepository).useClass(ArtRepository).asScoped();
    },
};
