import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { LlmService } from './llm.service.js';

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
        // Scoped, like `SpeechService` which it is shaped on: it holds no state between calls, and
        // everything about one generation lives in the call. The stream it hands back belongs to
        // the plugin instance rather than to this.
        registry.register(LlmService).useClass(LlmService).asScoped();
    },
};
