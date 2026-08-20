import { Container, Registry } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { NEWS_KIND } from '#modules/director/news.break.writer.js';
import { TopicsService } from '#modules/topics/topics.service.js';
import { inScope } from '#modules/shared/scoped.work.js';
import { NewsService } from './news.service.js';
import { NEWS_TOPIC_SEEDS } from './news.topic.defaults.js';

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
 *
 * The one thing it does at boot is seed the news CATEGORIES on a station that has none, which is in
 * `ready()` for `PersonasModule`'s reason: no first request depends on it, and a station with no
 * categories is a station whose bulletins read across everything, which is what every station did
 * before they existed.
 */
export const NewsModule: ServerKitModule = {
    name: 'News',
    setup: async (registry: Registry, _: AppConfig) => {
        // Scoped with the plugin registry and invoker it reads, like every other
        // capability consumer.
        registry.register(NewsService).useClass(NewsService).asScoped();
    },

    ready: async (container: Container, signal: AbortSignal) => {
        if (signal.aborted) return;

        // Never fatal. A station that could not be seeded is a station with no categories, which
        // reads the news exactly as it did before this existed.
        try {
            await inScope(container, async scope => {
                const written = await scope.get(TopicsService).seed(NEWS_KIND, NEWS_TOPIC_SEEDS);
                if (written > 0) container.get(Logger).info('news: wrote the station its first news categories', { written });
            });
        } catch (error) {
            container.get(Logger).warn('news: could not seed the news categories, so bulletins read across every feed', { error });
        }
    },
};
