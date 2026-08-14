import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ChartsService } from './charts.service.js';

/**
 * What is popular, out of whatever chart plugins are installed.
 *
 * Registered after `PluginsModule` for the reason `PlaylistsModule` and
 * `LlmModule` are: everything here resolves `PluginRegistry` and
 * `PluginInvoker`, and a module that reads the registry before the registry
 * exists finds an empty one rather than an error.
 *
 * It starts nothing and owns no loop. A chart is fetched because something asked
 * for one — an operator opening a page, a model calling a tool, a refill naming
 * records — never because time passed.
 */
export const ChartsModule: ServerKitModule = {
    name: 'Charts',
    setup: async (registry: Registry, _: AppConfig) => {
        // Scoped with the plugin registry and invoker it reads, like every other
        // capability consumer.
        registry.register(ChartsService).useClass(ChartsService).asScoped();
    },
};
