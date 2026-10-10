import { Container, Registry } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { errorText } from '#modules/shared/error.text.js';
import { inScope } from '#modules/shared/scoped.work.js';
import { ArtCacheOptions, ArtCacheService } from './art.cache.service.js';
import { ArtRepository } from './art.repository.js';
import { ArtService } from './art.service.js';
import { ArtStore } from './art.store.js';
import { BreakArtworkService } from './break.artwork.service.js';
import { CoverResolver } from './cover.resolver.js';
import { ArtSourceService } from './art.source.service.js';
import { configureArtSourceKey } from './art.source.token.js';
import { PersonaArtworkService } from './persona.artwork.service.js';

/** Where cached art is written when `ART_DIR` is unset. Alongside `logs/`, and gitignored with it. */
const DEFAULT_ART_DIR = './media/art';

/**
 * Where the pictures this repository ships for a kind of break are read from, when
 * `BREAK_ART_ASSETS_DIR` is unset.
 *
 * Tracked in the repository and part of the BUILD, which is `PAD_ASSETS_DIR`'s case exactly and has
 * its answer: not under `/data` or `/media`, because it is not something the operator gave the
 * station. The station copies one into its own art store on first boot and serves it from there, so
 * this directory is read at boot and when somebody presses Revert, and never otherwise.
 */
const DEFAULT_BREAK_ART_ASSETS_DIR = '../../assets/art/breaks';

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
 * Once bytes are cached, `catalog.art.ts` reports `art/<id>`. Before they are, every read reports
 * `art/source/<token>` instead, the upstream URL sealed with a key derived from the station's root
 * key (`art.source.token.ts`), and `GET /art/source/{token}` fetches it into the store on first ask
 * (`ArtSourceService`). So whatever the upstream URL carried in its query string stops at the API
 * whether or not the cover is cached yet. Until that existed, catalog reads handed out the upstream
 * URL verbatim, secrets and all, for as long as the sweep took; a new read must go through
 * `stationCover` to keep it that way.
 */
export const ArtModule: ServerKitModule = {
    name: 'Art',
    setup: async (registry: Registry, config: AppConfig) => {
        // The key every read seals an uncached cover's URL with (`art.source.token.ts`). Derived from
        // the root key `CryptoModule` has already insisted on, read off `config` because the root key
        // is scrubbed from the environment.
        configureArtSourceKey(String(config.get('KMS_LOCAL_ROOT_KEY', '')));

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
        // Scoped for the same reason: `GET /art/source/{token}`, which fetches through the cache service.
        registry.register(ArtSourceService).useClass(ArtSourceService).asScoped();
        // The real network: the platform's fetch and the system resolver, on `PodcastFetchOptions`'s
        // pattern. The fetch also reads `PluginOperatorHosts`, which `PluginsModule` registers further
        // down the list; nothing asks for it before the first sweep.
        registry
            .register(ArtCacheOptions)
            .useFactory(() => new ArtCacheOptions())
            .asSingleton();

        // Scoped like the two services beside it, and for the same reason: it writes through
        // `ArtRepository`. The shipped directory is a constructor argument rather than a config read
        // inside the class, on `PadLibrary`'s convention — it keeps the class testable against a
        // temp directory with no container.
        const breakArtAssetsDir = config.get('BREAK_ART_ASSETS_DIR', DEFAULT_BREAK_ART_ASSETS_DIR);
        registry
            .register(BreakArtworkService)
            .useFactory(
                container => new BreakArtworkService(container.get(ArtRepository), container.get(ArtStore), breakArtAssetsDir, container.get(Logger)),
            )
            .asScoped();

        // Scoped for the same reason: it writes through `ArtRepository`. Nothing shipped, so no directory.
        registry.register(PersonaArtworkService).useClass(PersonaArtworkService).asScoped();

        // Singleton, unlike the services above: it is a memory of which upstream covers the station
        // already holds, read by `/nowplaying` and the pusher, both of which answer without a scope.
        // A singleton factory is handed the ROOT container, which is what its own `inScope` needs.
        registry
            .register(CoverResolver)
            .useFactory(container => new CoverResolver(container, container.get(Logger)))
            .asSingleton();
    },

    /**
     * Take in the pictures this repository ships for a kind of break, where the station holds none.
     *
     * In `ready` rather than `setup`, on the rule in `apps/api/CLAUDE.md`: nothing the first request
     * does depends on it, and it is a directory read plus a row and a file per picture. In its own
     * try for `RenderModule.ready`'s reason — a picture that cannot be read is a break wearing the
     * station's logo, which is what every break did before this existed, and never a reason to
     * refuse to boot.
     */
    ready: async (container: Container, signal: AbortSignal) => {
        if (signal.aborted) return;
        const logger = container.get(Logger);

        try {
            const taken = await inScope(container, async scope => scope.get(BreakArtworkService).seed());
            if (taken > 0) logger.info('art: took in the pictures shipped for a kind of break', { pictures: taken });
        } catch (error) {
            logger.warn(`art: could not take in the pictures shipped for a kind of break (${errorText(error)})`);
        }
    },
};
