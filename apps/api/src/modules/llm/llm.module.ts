import { Container, Registry } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { CatalogSearchTool } from './catalog.search.tool.js';
import { ProviderSearch } from './provider.search.js';
import { ChartsTool } from './charts.tool.js';
import { LibrarySearchTool } from './library.search.tool.js';
import { LlmGate } from './llm.gate.js';
import { LlmService } from './llm.service.js';
import { NewsTool } from './news.tool.js';
import { SimilarArtistsTool } from './similar.artists.tool.js';
import { ToolRegistry } from './llm.tools.js';
import { ShowSoFarTool } from './show.so.far.tool.js';
import { StationTasteTool } from './station.taste.tool.js';

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
        // consumer here. The fan-out is its own thing rather than the tool's body, because reaching
        // the providers and telling a model how to ask are two jobs and only the second is a tool.
        registry.register(ProviderSearch).useClass(ProviderSearch).asScoped();
        registry.register(CatalogSearchTool).useClass(CatalogSearchTool).asScoped();
        // Scoped with the catalog repository it reads. Not a plugin consumer at all, which is the
        // difference between the two search tools: this one asks what the station HAS.
        registry.register(LibrarySearchTool).useClass(LibrarySearchTool).asScoped();
        // Also a catalog read rather than a plugin one, and offered to every caller rather than to
        // selection alone: "the station loves this band" is a thing a break writer says on air.
        registry.register(StationTasteTool).useClass(StationTasteTool).asScoped();
        // Two history reads rather than a catalog one, and the only source here that answers about
        // the broadcast in progress rather than about the library. Scoped with the repositories it
        // reads, both of which are scoped themselves.
        registry.register(ShowSoFarTool).useClass(ShowSoFarTool).asScoped();
        // Scoped with the `ChartsService` it adapts, which is scoped with the plugin registry it
        // reads. Unlike the three above, the thing behind this one is somebody else's service, which
        // is exactly why the fetching half is a plugin and only the adapter lives here.
        registry.register(ChartsTool).useClass(ChartsTool).asScoped();
        // The other plugin-backed source, beside the charts one and for the same reason: the thing
        // it talks to is somebody else's service, so the fetching lives in a plugin and only the
        // adapter is here.
        registry.register(SimilarArtistsTool).useClass(SimilarArtistsTool).asScoped();
        // The third plugin-backed source, and the only one here that is not about records at all:
        // what comes back cannot be played, so nothing downstream of it touches the pick path and
        // the only thing a DJ can do with it is talk.
        registry.register(NewsTool).useClass(NewsTool).asScoped();

        // The source list is explicit rather than discovered, so what the model can reach is one
        // readable line rather than the sum of whatever registered itself. A `tool` plugin
        // capability becomes another entry here and nothing else changes.
        //
        // The library first. Order here is only a tie-break on duplicate NAMES, which these do not
        // have, but it is also the order the declarations reach the model — and the tool a DJ should
        // reach for when choosing what to play is the one that answers with records it can actually
        // schedule. The charts go last for the same reason read the other way round: they are the
        // one source that knows nothing about whether the station can play what it names.
        registry
            .register(ToolRegistry)
            .useFactory(
                (container: Container) =>
                    new ToolRegistry(
                        [
                            container.get(LibrarySearchTool),
                            container.get(CatalogSearchTool),
                            container.get(StationTasteTool),
                            // Ahead of the plugin-backed three, behind the two that answer with
                            // records: a writer reaching for context about the show it is in the
                            // middle of should find this before anything that goes off the station.
                            container.get(ShowSoFarTool),
                            container.get(SimilarArtistsTool),
                            container.get(ChartsTool),
                            // Last, and for a different reason than the charts: this one does not
                            // answer the question the others do. A model choosing records is not
                            // helped by it, and a model writing a break reaches it after everything
                            // that might tell it what is actually playing.
                            container.get(NewsTool),
                        ],
                        container.get(Logger),
                    ),
            )
            .asScoped();

        // Scoped, like `SpeechService` which it is shaped on: it holds no state between calls, and
        // everything about one generation lives in the call. The stream it hands back belongs to
        // the plugin instance rather than to this. It resolves the singleton gate, which is how one
        // slot is shared across every scope.
        registry.register(LlmService).useClass(LlmService).asScoped();
    },
};
