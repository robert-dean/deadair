import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { SimilarityService } from './similarity.service.js';
import { SimilarityStoreRepository } from './similarity.store.repository.js';
import { SimilarityGraphService } from './similarity.graph.service.js';

/**
 * Who else sounds like this, out of whatever similarity plugins are installed.
 *
 * Registered after `PluginsModule` for the reason `ChartsModule` and `LlmModule`
 * are: everything here resolves `PluginRegistry` and `PluginInvoker`.
 *
 * It starts nothing and owns no loop. An artist is looked up because a refill or
 * a break writer asked, never because time passed.
 */
export const SimilarityModule: ServerKitModule = {
    name: 'Similarity',
    setup: async (registry: Registry, _: AppConfig) => {
        // Scoped like every other capability consumer. Its cache is static on the
        // class rather than on the instance, precisely because this is scoped —
        // see the note there.
        registry.register(SimilarityService).useClass(SimilarityService).asScoped();
        // What the sources have said, kept: see `0119_similarity_store.sql`. Scoped like every
        // repository, so it shares the scope's database handle.
        registry.register(SimilarityStoreRepository).useClass(SimilarityStoreRepository).asScoped();
        // The store read back as a graph, for `GET /catalog/similarity`. Reads the store only.
        registry.register(SimilarityGraphService).useClass(SimilarityGraphService).asScoped();
    },
};
