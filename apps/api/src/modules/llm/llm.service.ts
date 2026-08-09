import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import {
    collectGeneration,
    PluginError,
    type LlmHandle,
    type LlmModelInfo,
    type LlmRequest,
    type LlmResult,
    type LlmUsage,
} from '@deadair/plugin-sdk';
import { asLlmPlugin, type LlmPlugin } from '#modules/plugins/plugin.capabilities.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { LlmGate } from './llm.gate.js';
import { explainNoGenerator, LLM_PLUGIN_KEY, selectLlmPlugin } from './llm.settings.js';
import { ToolRegistry, type StationTool } from './llm.tools.js';

/**
 * How long the plugin gets to hand back a handle.
 *
 * Bounds STARTING a generation and nothing more, exactly as `SPEAK_TIMEOUT_MS` bounds a speech
 * request and its headers. The words arrive afterwards, which is the whole reason a long answer does
 * not have to be a long invocation.
 *
 * Generous, because the model this station is pointed at is a remote Ollama whose first token can be
 * a while coming when the context spills its VRAM. A bound tight enough to catch that is also tight
 * enough to abort every ordinary generation on a busy machine.
 */
export const START_TIMEOUT_MS = 120_000;

/**
 * How long a whole generation gets, from being admitted to the model to the last word.
 *
 * This is the one that matters, because a generation holds the station's only model slot until its
 * stream ends. Without it, one model that produces forever costs the station every future line it
 * would have said, and the symptom is a station that quietly stops talking.
 *
 * Well above {@link START_TIMEOUT_MS}: a show is thousands of tokens and the slow path here is two
 * tokens a second, so this has to accommodate the case the deterministic writer exists to rescue
 * rather than pre-empt it.
 */
export const GENERATION_BUDGET_MS = 600_000;

/**
 * How many times a conversation may go round the tool loop before it has to answer in words.
 *
 * A back-announce that checks the library needs one. Something that checks two things needs two.
 * Past a handful, a model is not gathering facts any more, it is looping, and every step is
 * another whole generation held against the station's only model slot.
 */
export const MAX_TOOL_STEPS = 4;

/** How one caller wants its generation treated. Every field falls back to this module's own bounds. */
export interface LlmCallOptions {
    /** Override {@link GENERATION_BUDGET_MS} for one call. */
    budgetMs?: number;

    /**
     * Give up waiting for the model after this long, before anything is spent.
     *
     * Absent means wait. Worth setting for anything with a deadline of its own: a break writer that
     * would rather produce a deterministic line now than a better one after the show in front of it
     * finishes should say so here.
     */
    maxWaitMs?: number;
}

/** {@link LlmCallOptions}, plus what a conversation may do with tools. */
export interface LlmConverseOptions extends LlmCallOptions {
    /** Set `false` for a conversation that must not call anything. Absent means offer what there is. */
    tools?: boolean;

    /** Override {@link MAX_TOOL_STEPS} for one conversation. */
    maxToolSteps?: number;
}

/** Fold one generation's usage into a conversation's running total. */
function addUsage(total: LlmUsage, step: LlmUsage | undefined): void {
    if (step === undefined) return;

    // A conversation is several generations and its cost is their sum, so a caller logging this sees
    // what the answer actually cost rather than what its last step did.
    if (step.inputTokens !== undefined) total.inputTokens = (total.inputTokens ?? 0) + step.inputTokens;
    if (step.outputTokens !== undefined) total.outputTokens = (total.outputTokens ?? 0) + step.outputTokens;
    if (step.totalTokens !== undefined) total.totalTokens = (total.totalTokens ?? 0) + step.totalTokens;
}

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
        private readonly gate: LlmGate,
        private readonly tools: ToolRegistry,
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
    async generate(request: LlmRequest, options: LlmCallOptions = {}): Promise<LlmHandle> {
        const plugin = this.generator();
        if (plugin === undefined) throw new PluginError(`llm: ${this.explainGenerator()}`).withCode('unavailable');

        return await this.generateWith(plugin, request, options);
    }

    /**
     * As {@link generate}, against a plugin the caller already chose.
     *
     * Separate so a console can exercise a named plugin without it having to be the station's
     * current one, which is how an operator decides whether it should be.
     *
     * Every generation goes through the gate, including this one. A console preview that jumped the
     * queue would be doing the exact thing the gate exists to stop, on a station that is on air.
     */
    async generateWith(plugin: LlmPlugin, request: LlmRequest, options: LlmCallOptions = {}): Promise<LlmHandle> {
        const gated = await this.gate.run<LlmResult>(
            async () =>
                await this.pluginInvoker.invoke(
                    plugin.record.id,
                    'llm.generate',
                    async () => {
                        const handle = await plugin.instance.generate(request);
                        return { stream: handle.text, result: handle.result };
                    },
                    // Bounds getting the handle back, and stops there. The words arrive afterwards
                    // and are bounded by the gate's budget instead, because they are what holds the
                    // station's only model slot.
                    { timeoutMs: START_TIMEOUT_MS },
                ),
            {
                budgetMs: options.budgetMs ?? GENERATION_BUDGET_MS,
                ...(options.maxWaitMs === undefined ? {} : { maxWaitMs: options.maxWaitMs }),
                label: plugin.record.id,
            },
        );

        return { text: gated.stream, result: gated.result };
    }

    /**
     * Ask for an answer, letting the model use the station's tools to get there.
     *
     * The counterpart to {@link generate}, and the one most callers want. That one hands back a
     * stream for a caller showing words as they arrive; this one runs the conversation to its end
     * and answers with the finished result, because a tool round trip has no single stream to show.
     *
     * ## The loop is host-side, and once
     *
     * Every writer gets the same loop rather than each reimplementing it, and no plugin gets to
     * implement it at all: a tool is a station function, so running one belongs on this side of the
     * boundary. What crosses is declarations going out and calls coming back, both plain data.
     *
     * ## It is one gate admission
     *
     * The whole loop holds the model, including the station's own work between steps. Releasing
     * between round trips would let another generation interleave and evict the cache this loop's
     * next step is about to want, and restart the budget clock mid-answer.
     *
     * ## Tools are offered only to a model that says it can take them
     *
     * And when the loop runs out of steps, the last generation is made with no tools at all, so the
     * model has to answer in words. Without that a caller can be handed a result whose only content
     * is a request for a tool call nobody is going to make, which reads downstream as the model
     * having said nothing.
     */
    async converse(request: LlmRequest, options: LlmConverseOptions = {}): Promise<LlmResult> {
        const plugin = this.generator();
        if (plugin === undefined) throw new PluginError(`llm: ${this.explainGenerator()}`).withCode('unavailable');

        const maxSteps = options.maxToolSteps ?? MAX_TOOL_STEPS;
        const tools = await this.toolsFor(plugin, request, options);

        return await this.gate.hold(async signal => await this.runConversation(plugin, request, tools, maxSteps, signal), {
            budgetMs: options.budgetMs ?? GENERATION_BUDGET_MS,
            ...(options.maxWaitMs === undefined ? {} : { maxWaitMs: options.maxWaitMs }),
            label: plugin.record.id,
        });
    }

    /**
     * What the model may call this time, or nothing.
     *
     * A caller's explicit `request.tools` wins, so something that wants a bare conversation can have
     * one. Otherwise the registry's, and only when the model is declared able to take them: sending
     * tools to a model that cannot is a failed generation, and the fallback for a break written
     * without them is a correct sentence.
     */
    private async toolsFor(plugin: LlmPlugin, request: LlmRequest, options: LlmConverseOptions): Promise<Map<string, StationTool>> {
        if (request.tools !== undefined) return new Map();
        if (options.tools === false) return new Map();

        if (!(await this.supportsTools(plugin, request.model))) {
            this.logger.debug('llm: the model is not declared able to use tools, so none were offered', { plugin: plugin.record.id });
            return new Map();
        }

        return await this.tools.tools();
    }

    /** The loop itself, inside the gate. */
    private async runConversation(
        plugin: LlmPlugin,
        request: LlmRequest,
        tools: Map<string, StationTool>,
        maxSteps: number,
        signal: AbortSignal,
    ): Promise<LlmResult> {
        const declarations = [...tools.values()].map(tool => tool.declaration);
        const messages = [...request.messages];
        const usage: LlmUsage = {};

        for (let step = 0; ; step++) {
            // The last step is asked WITHOUT tools, so the model has to produce words rather than
            // ask for something nobody will run.
            const lastStep = step >= maxSteps;
            const offered = lastStep || declarations.length === 0 ? undefined : declarations;

            const result = await this.generateOnce(plugin, { ...request, messages, ...(offered === undefined ? {} : { tools: offered }) });
            addUsage(usage, result.usage);

            if (result.toolCalls.length === 0 || lastStep) {
                return { ...result, usage };
            }

            if (signal.aborted) {
                // The budget went while the station was doing its own work. Answer with what the
                // model has said so far rather than throwing: a partial line is worth more to a
                // writer that can fall back than an exception is.
                this.logger.info('llm: a conversation ran out of budget mid-loop', { plugin: plugin.record.id, step });
                return { ...result, usage, finishReason: 'length' };
            }

            // The assistant turn AND its calls, as one message. A model that cannot see its own
            // request has no idea what the results after it are answering.
            messages.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls });

            for (const call of result.toolCalls) {
                const answer = await this.tools.run(call, tools, signal);
                messages.push({ role: 'tool', toolCallId: call.id, content: answer });
            }

            this.logger.debug('llm: ran tools for a conversation', { plugin: plugin.record.id, step, calls: result.toolCalls.length });
        }
    }

    /**
     * One generation, drained, WITHOUT the gate.
     *
     * Private and ungated on purpose: its only caller is already holding the slot, and going through
     * `gate.run` from inside `gate.hold` would be a caller queueing behind itself.
     */
    private async generateOnce(plugin: LlmPlugin, request: LlmRequest): Promise<LlmResult> {
        const handle = await this.pluginInvoker.invoke(plugin.record.id, 'llm.generate', async () => plugin.instance.generate(request), {
            timeoutMs: START_TIMEOUT_MS,
        });

        return await collectGeneration(handle);
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
     * `undefined` for the model means the plugin's own default, and a plugin that says which entry
     * that is gets asked about that one. Without a marked default there is nothing to resolve
     * against, so this falls back to requiring EVERY model to support tools — correct, and
     * increasingly useless the more models a server has, which is why the SDK asks plugins to mark
     * one. Both readings err the same way: never claiming support that is not there, because the
     * cost of being wrong is a failed generation and the cost of being cautious is a line written
     * without facts.
     */
    async supportsTools(plugin: LlmPlugin, model: string | undefined): Promise<boolean> {
        const models = await this.models(plugin);
        if (models.length === 0) return false;

        const named = model?.trim();
        if (named !== undefined && named.length > 0) return models.find(entry => entry.id === named)?.tools === true;

        const fallback = models.find(entry => entry.default === true);
        if (fallback !== undefined) return fallback.tools;

        return models.every(entry => entry.tools);
    }
}
