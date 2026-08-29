import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { WeatherService } from './weather.service.js';

/**
 * What it is like outside, out of whatever weather plugins are installed.
 *
 * Registered after `PluginsModule` for the reason `NewsModule` and `SearchModule`
 * are: everything here resolves `PluginRegistry` and `PluginInvoker`, and a
 * module that reads the registry before the registry exists finds an empty one
 * rather than an error. Before `TopicsModule`, because this module owns a kind
 * that has subjects, and before `LlmModule` and `DirectorModule`, which are the
 * two that ask it — one as a tool the presenter can call mid-sentence, one as the
 * substrate of a weather break.
 *
 * It starts nothing and owns no loop. A service is asked because something asked
 * — a model mid-conversation, a break about to be written, an operator testing a
 * plugin — never because time passed. The window in which a reading is reused
 * belongs to the plugin, which is the only party that knows how often its own
 * service publishes.
 */
export const WeatherModule: ServerKitModule = {
    name: 'Weather',
    setup: async (registry: Registry, _: AppConfig) => {
        // Scoped like every other capability consumer. It holds no cache of its
        // own, deliberately: the plugin already has one keyed by place and by how
        // much forecast was asked for, and a second in front of it would be a
        // window an operator can see in the settings form and a window they
        // cannot.
        registry.register(WeatherService).useClass(WeatherService).asScoped();
    },
};
