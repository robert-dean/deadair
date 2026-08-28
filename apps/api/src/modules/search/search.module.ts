import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { SearchService } from './search.service.js';

/**
 * What the open web says, out of whatever search plugins are installed.
 *
 * Registered after `PluginsModule` for the reason `NewsModule` and
 * `SimilarityModule` are: everything here resolves `PluginRegistry` and
 * `PluginInvoker`, and a module that reads the registry before the registry
 * exists finds an empty one rather than an error. Before `LlmModule`, which is
 * the one thing that consumes it.
 *
 * It starts nothing and owns no loop. A question is asked because something
 * asked it — a model mid-conversation, an enrichment walk looking for prose —
 * never because time passed. Nothing here polls, and nothing here can put a
 * result on air.
 */
export const SearchModule: ServerKitModule = {
    name: 'Search',
    setup: async (registry: Registry, _: AppConfig) => {
        // Scoped like every other capability consumer. Its cache is static on
        // the class rather than on the instance, precisely because this is
        // scoped — see the note there.
        registry.register(SearchService).useClass(SearchService).asScoped();
    },
};
