import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { NewsService } from './news.service.js';

/**
 * What happened outside the station, out of whatever news plugins are installed.
 *
 * Registered after `PluginsModule` for the reason `ChartsModule` and
 * `PlaylistsModule` are: everything here resolves `PluginRegistry` and
 * `PluginInvoker`, and a module that reads the registry before the registry
 * exists finds an empty one rather than an error.
 *
 * It starts nothing and owns no loop. A feed is read because something asked —
 * an operator opening a page, a model calling a tool — never because time
 * passed. A loop that polls for what is new is the thing a breaking-news break
 * would need, and it belongs to whatever posts the break rather than here.
 */
export const NewsModule: ServerKitModule = {
    name: 'News',
    setup: async (registry: Registry, _: AppConfig) => {
        // Scoped with the plugin registry and invoker it reads, like every other
        // capability consumer.
        registry.register(NewsService).useClass(NewsService).asScoped();
    },
};
