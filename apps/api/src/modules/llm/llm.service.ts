import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { PluginError, type LlmHandle, type LlmModelInfo, type LlmRequest } from '@deadair/plugin-sdk';
import { asLlmPlugin, type LlmPlugin } from '#modules/plugins/plugin.capabilities.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { explainNoGenerator, LLM_PLUGIN_KEY, selectLlmPlugin } from './llm.settings.js';

/**
 * How long one `generate` may take before the host abandons it.
 *
 * Bounds getting the HANDLE back and nothing more, exactly as `SPEAK_TIMEOUT_MS` bounds a request
 * and its headers: the words arrive afterwards, on the host's own per-body idle and lifetime caps.
 * That split is the whole reason a long answer does not have to be a long invocation.
 *
 * Generous, because the model this station is pointed at is a remote Ollama whose first token can
 * be a while coming when the context spills its VRAM. A budget tight enough to catch that is also
 * tight enough to abort every ordinary generation on a busy machine.
 */
export const GENERATE_TIMEOUT_MS = 120_000;

/**
 * Asking a model for words.
 *
 * The one place that knows how, so everything downstream (a break writer, a set generator, a show)
 * gets the same choice of plugin, the same budget and the same failure vocabulary rather than each
 * learning the dance. Shaped on `SpeechService`, which solved the identical problem for audio.
 *
 * ## Nothing here decides what to say
 *
 * This is a transport. It takes a conversation and hands back the answer. Everything about WHAT to
 * put in that conversation is the caller's, which is what keeps one seam serving a back-announce, a
 * bulletin and a running order instead of being reshaped for each.
 *
 * ## Nothing here is required to work
 *
 * A station with no model plugin is every fresh install, and it is not a fault. {@link generator}
 * answers `undefined` with a reason rather than throwing, so a caller can fall back to writing the
 * line deterministically. That fallback is the floor the whole DJ rests on: a model that is absent,
 * slow or broken must cost a better sentence, never a silent station.
 */
@Injectable()
export class LlmService {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * The plugin id the operator chose, or an empty string for "they have not".
     *
     * From the config rather than the settings repository, so this costs no query and no scope:
     * `deadair.settings` is a layer of the app's config, and a write to the row is live here on the
     * next read.
     */
    private get configuredGenerator(): string {
        return this.config.get(LLM_PLUGIN_KEY, '');
    }

    /** Every plugin that could produce words right now, in a stable order. */
    generators(): LlmPlugin[] {
        const plugins: LlmPlugin[] = [];
        for (const record of this.pluginRegistry.list()) {
            const plugin = asLlmPlugin(record);
            if (plugin) plugins.push(plugin);
        }
        return plugins.sort((left, right) => left.record.id.localeCompare(right.record.id));
    }

    /**
     * The plugin the station thinks with, or `undefined` with a reason logged.
     *
     * Not a throw. Every caller treats "no model" as a state rather than a fault, because the
     * station wrote its own breaks before there was one and still can.
     */
    generator(): LlmPlugin | undefined {
        const candidates = this.generators();
        const configured = this.configuredGenerator;
        const chosen = selectLlmPlugin(candidates, configured);

        if (chosen === undefined) this.logger.info(`llm: nothing to think with (${explainNoGenerator(candidates, configured)})`);
        return chosen;
    }

    /**
     * Whether a model is available at all.
     *
     * Part of the public surface rather than an internal check, and deliberately cheap: a writer
     * choosing between its model binding and its deterministic one asks this first, and it must not
     * have to catch an exception to find out. Silent, unlike {@link generator}, because a caller
     * asking every time it writes a line should not log every time it writes a line.
     */
    canGenerate(): boolean {
        return selectLlmPlugin(this.generators(), this.configuredGenerator) !== undefined;
    }

    /**
     * Why there is nothing to think with, in a sentence an operator can act on.
     *
     * Answers a sentence even when there IS a generator, so it is only worth calling once
     * {@link generator} or {@link canGenerate} has said there is not.
     */
    explainGenerator(): string {
        return explainNoGenerator(this.generators(), this.configuredGenerator);
    }

    /**
     * Ask the station's model to continue a conversation.
     *
     * Answers a handle, not the words: read `handle.text` to the end (or `cancel()` it) and then
     * await `handle.result`, or hand the whole thing to `collectGeneration`. The stream is what lets
     * a caller show words as they arrive, and it is what the gate wrapping this measures a
     * generation's real end by.
     *
     * @throws {PluginError} `unavailable` when no plugin can produce words, and whatever the plugin
     * itself threw otherwise — `config` for one that is not set up, `unsupported` for tools the
     * named model cannot do, `timeout`, `rate_limited`, `upstream`. Every one of them is a
     * `PluginError`, because `PluginInvoker` flattens anything else, so a caller branches on `code`
     * rather than on a message.
     */
    async generate(request: LlmRequest): Promise<LlmHandle> {
        const plugin = this.generator();
        if (plugin === undefined) throw new PluginError(`llm: ${this.explainGenerator()}`).withCode('unavailable');

        return await this.generateWith(plugin, request);
    }

    /**
     * As {@link generate}, against a plugin the caller already chose.
     *
     * Separate so a console can exercise a named plugin without it having to be the station's
     * current one, which is how an operator decides whether it should be.
     */
    async generateWith(plugin: LlmPlugin, request: LlmRequest): Promise<LlmHandle> {
        return await this.pluginInvoker.invoke(plugin.record.id, 'llm.generate', async () => plugin.instance.generate(request), {
            timeoutMs: GENERATE_TIMEOUT_MS,
        });
    }

    /**
     * The models one plugin offers, or none when it cannot say.
     *
     * `listModels` is optional in the SDK, so a plugin without it is not broken and answers an empty
     * list. What that costs is tools: {@link supportsTools} has nothing to read, so the host sends
     * none.
     */
    async models(plugin: LlmPlugin): Promise<LlmModelInfo[]> {
        if (!plugin.listsModels) return [];
        return await this.pluginInvoker.invoke(plugin.record.id, 'llm.listModels', async () => (await plugin.instance.listModels?.()) ?? []);
    }

    /**
     * Whether a given model can be given tools.
     *
     * Asked per model rather than per plugin because that is where the truth lives: one endpoint
     * commonly serves both a model that can call tools and one that cannot, so a plugin-level
     * answer would be wrong for half of them.
     *
     * `undefined` for the model means the plugin's own default, which is the ordinary case and the
     * one thing this cannot resolve from here — a plugin knows which model it is configured with and
     * the host does not. So an unnamed model gets tools only when EVERY model the plugin lists
     * supports them, which is the conservative reading and the one that cannot produce a failed
     * generation.
     */
    async supportsTools(plugin: LlmPlugin, model: string | undefined): Promise<boolean> {
        const models = await this.models(plugin);
        if (models.length === 0) return false;

        const named = model?.trim();
        if (named !== undefined && named.length > 0) return models.find(entry => entry.id === named)?.tools === true;

        return models.every(entry => entry.tools);
    }
}
