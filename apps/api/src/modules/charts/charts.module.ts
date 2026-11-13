import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ChartsService } from './charts.service.js';
import { StationChartRepository } from './station.chart.repository.js';
import { StationChartSource } from './station.chart.source.js';

/**
 * What is popular, out of whatever chart plugins are installed.
 *
 * Registered after `PluginsModule` for the reason `PlaylistsModule` and
 * `LlmModule` are: everything here resolves `PluginRegistry` and
 * `PluginInvoker`, and a module that reads the registry before the registry
 * exists finds an empty one rather than an error.
 *
 * The station's own charts are worked out here too, from tables it reads and never writes
 * (`play_history`, `listener_requests`, `track_skips` and the catalog's ratings), so it depends on
 * no module registered after it: a table is there from the first migration whatever order the
 * modules start in.
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
        registry.register(StationChartSource).useClass(StationChartSource).asScoped();
        registry.register(StationChartRepository).useClass(StationChartRepository).asScoped();
    },
};
