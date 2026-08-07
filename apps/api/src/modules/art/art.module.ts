import { Registry } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { ArtCacheService } from './art.cache.service.js';
import { ArtRepository } from './art.repository.js';
import { ArtService } from './art.service.js';
import { ArtStore } from './art.store.js';

/** Where cached art is written when `ART_DIR` is unset. Alongside `logs/`, and gitignored with it. */
const DEFAULT_ART_DIR = './media/art';

/**
 * Locally cached artwork: the files, and the rows that say what is in them.
 *
 * Registered before the catalog because catalog reads join `art_assets` to hand out a local URL in
 * place of the upstream one, and nothing here reaches back into the catalog.
 *
 * ## What this module assumes about a source URL
 *
 * `art_assets` is keyed by `source_url`, and treats that URL as a stable *identity* for the image
 * rather than merely a way to reach it. A provider that mints a per-call-varying URL for the same
 * cover — a rotating token, a timestamp, a per-request nonce in the query string — mints a fresh
 * row and a fresh download every time the image is mentioned, and the cache never hits. Nothing
 * errors when that happens: it shows up only as a pending queue that never drains and a store full
 * of identical bytes under different ids, which is why the assumption is written down here instead
 * of being left to whoever notices the disk filling. `SubsonicAuth.stableParams` in
 * `plugins/navidrome` is the worked example of a provider meeting it, holding one salt for the life
 * of the plugin so a credentialed cover URL is the same string every time it is minted.
 *
 * ## What caching art does and does not do for a credential
 *
 * Once bytes are cached, `catalog.art.ts` reports `art/<id>` and whatever the upstream URL carried
 * in its query string stops at the API rather than reaching the browser. That is a real benefit and
 * it is the reason a credentialed provider is servable at all, but it is not a credential firewall:
 * until a fetch succeeds, catalog reads hand out the upstream URL verbatim, secrets and all, and a
 * URL whose fetches permanently fail is handed out verbatim forever. The window is as long as it
 * takes the sweep to get the bytes, not zero. Do not write docs or UI copy claiming otherwise.
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
        // the sweeper executes as. The two services above it share that lifetime, one serving the
        // bytes and one fetching them.
        registry.register(ArtRepository).useClass(ArtRepository).asScoped();
        registry.register(ArtService).useClass(ArtService).asScoped();
        registry.register(ArtCacheService).useClass(ArtCacheService).asScoped();
    },
};
