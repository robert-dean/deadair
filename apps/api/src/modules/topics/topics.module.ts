import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import type { TopicKind } from './topic.js';
import { TopicKindRegistry } from './topic.kind.registry.js';
import { TopicRepository } from './topic.repository.js';
import { TopicsService } from './topics.service.js';

/**
 * What the station's breaks can be ABOUT: the operator's own vocabulary, per sort of break.
 *
 * Registered after the modules that OWN the kinds and before `DirectorModule`, which is what reads a
 * subject back when a break is written. The first of those edges is the one `LlmModule` already has
 * with its tool sources: the registry knows its entries, the entries know nothing about the
 * registry, and a second kind is one file plus one line in the list below.
 *
 * It starts nothing and owns no loop. A subject is written because an operator wrote it and read
 * because something is about to say something.
 */
export const TopicsModule: ServerKitModule = {
    name: 'Topics',
    setup: async (registry: Registry, _: AppConfig) => {
        // Scoped like every other repository: the job runner gives each execution its own scope, so
        // this is per-run there and per-request on the request path.
        registry.register(TopicRepository).useClass(TopicRepository).asScoped();

        // Which sorts of break have subjects at all. An explicit list, exactly as `ToolRegistry`'s
        // sources are: nothing scans, nothing self-registers, and what the station can name is
        // readable in one place.
        //
        // Empty until a kind declares itself, which is an ordinary state — the console page says
        // there is nothing to name yet, which is true.
        registry
            .register(TopicKindRegistry)
            .useFactory(() => new TopicKindRegistry(KINDS))
            .asSingleton();

        registry.register(TopicsService).useClass(TopicsService).asScoped();
    },
};

/** The kinds that take subjects, in the order a console should draw them. */
const KINDS: readonly TopicKind[] = [];
