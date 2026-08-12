import { Container, Registry } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { CatalogSearchTool } from './catalog.search.tool.js';
import { LibrarySearchTool } from './library.search.tool.js';
import { LlmGate } from './llm.gate.js';
import { LlmService } from './llm.service.js';
import { ToolRegistry } from './llm.tools.js';

/**
 * Asking a model for words.
 *
 * Registered after `PluginsModule`, for the same reason `PlaylistsModule` is: everything here
 * resolves `PluginRegistry` and `PluginInvoker`, and a module that reads the registry before the
 * registry exists finds an empty one rather than an error. Before `RenderModule` and
 * `DirectorModule`, which are the two that will consume it.
 *
 * ## It starts nothing
 *
 * There is no loop, no boot scan and no work on the request path. A generation happens because
 * something asked for one, never because time passed, which is why this module has no `start` and
 * no `ready`.
 *
 * ## What lives here and what does not
 *
 * Here: which plugin the station thinks with, the budget one generation gets, and (as this grows)
 * the single-slot gate and the tool loop. All of it host-side on purpose, so every writer gets the
 * same behaviour instead of each plugin reimplementing it and getting it subtly different.
 *
 * Not here: the base URL, the model, the credentials, the temperature. Those are the PLUGIN's
 * config, exactly as the speech engine's knobs are, because they are per-provider and the host has
 * no business carrying them. And not here either: anything that knows what a break is. This module
 * takes a conversation and answers with words. What to say belongs to whoever is writing.
 *
 * See `docs/todo/dj-voice.md` for the writer that lands on top of this, and why the deterministic
 * one underneath it is a floor rather than a stepping stone.
 */
export const LlmModule: ServerKitModule = {
    name: 'Llm',
    setup: async (registry: Registry) => {
        // SINGLETON, and this is the one registration here that would be a bug any other way. The
        // gate is one slot for the process, because there is one model. Scoped, every request would
        // get a gate of its own and two concurrent requests would overlap on the model exactly as
        // if there were no gate at all — while every test of the gate in isolation still passed.
        registry.register(LlmGate).useClass(LlmGate).asSingleton();

        // Scoped with the plugin registry and invoker it reads, like every other capability
        // consumer here.
        registry.register(CatalogSearchTool).useClass(CatalogSearchTool).asScoped();
        // Scoped with the catalog repository it reads. Not a plugin consumer at all, which is the
        // difference between the two search tools: this one asks what the station HAS.
        registry.register(LibrarySearchTool).useClass(LibrarySearchTool).asScoped();

        // The source list is explicit rather than discovered, so what the model can reach is one
        // readable line rather than the sum of whatever registered itself. A `tool` plugin
        // capability becomes another entry here and nothing else changes.
        //
        // The library first. Order here is only a tie-break on duplicate NAMES, which these two do
        // not have, but it is also the order the declarations reach the model — and the tool a DJ
        // should reach for when choosing what to play is the one that answers with records it can
        // actually schedule.
        registry
            .register(ToolRegistry)
            .useFactory(
                (container: Container) =>
                    new ToolRegistry([container.get(LibrarySearchTool), container.get(CatalogSearchTool)], container.get(Logger)),
            )
            .asScoped();

        // Scoped, like `SpeechService` which it is shaped on: it holds no state between calls, and
        // everything about one generation lives in the call. The stream it hands back belongs to
        // the plugin instance rather than to this. It resolves the singleton gate, which is how one
        // slot is shared across every scope.
        registry.register(LlmService).useClass(LlmService).asScoped();
    },
};
