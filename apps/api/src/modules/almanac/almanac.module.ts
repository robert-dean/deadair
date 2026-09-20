import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { AlmanacService } from './almanac.service.js';

/**
 * What happened on the station's own date, out of whatever almanac plugins are
 * installed.
 *
 * Registered after `PluginsModule` for the reason `WeatherModule` and
 * `NewsModule` are: everything here resolves `PluginRegistry` and
 * `PluginInvoker`, and a module that reads the registry before the registry
 * exists finds an empty one rather than an error. Before `LlmModule` and
 * `DirectorModule`, which are the two that ask it — one as a tool the presenter
 * can call mid-sentence, one as the substrate of a break about the day.
 *
 * It starts nothing and owns no loop. A source is asked because something asked,
 * never because time passed, and the window in which a day is reused belongs to
 * the plugin — which is the only party that knows how often its own service
 * changes, and in this case knows the answer is "hardly ever".
 *
 * No topic kind, unlike the weather. A location is a choice with something in it
 * (which town, and in whose units); a date is not a choice at all, and what the
 * station makes of it is one setting rather than a row an operator has to
 * create. A band on the format clock therefore points at the kind and at
 * nothing else.
 */
export const AlmanacModule: ServerKitModule = {
    name: 'Almanac',
    setup: async (registry: Registry, _: AppConfig) => {
        // Scoped like every other capability consumer. It holds no cache of its
        // own, deliberately: the plugin already has one keyed by the date, and a
        // second in front of it would be a window an operator can see in the
        // settings form and a window they cannot.
        registry.register(AlmanacService).useClass(AlmanacService).asScoped();
    },
};
