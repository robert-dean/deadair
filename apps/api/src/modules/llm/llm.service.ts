import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import {
    collectGeneration,
    PluginError,
    type LlmFinishReason,
    type LlmHandle,
    type LlmMessage,
    type LlmModelInfo,
    type LlmRequest,
    type LlmResult,
    type LlmUsage,
} from '@deadair/plugin-sdk';
import { asLlmPlugin, type LlmPlugin } from '#modules/plugins/plugin.capabilities.js';
import { byPluginId, defaultPickIsNews, pluginsWith } from '#modules/plugins/plugin.selection.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import type { GatePriority } from '#modules/shared/gate.priority.js';
import { LlmGate } from './llm.gate.js';
import { explainDefaultGenerator, explainNoGenerator, LLM_PLUGIN_KEY, selectLlmPlugin } from './llm.settings.js';
import { ToolRegistry, type StationTool } from './llm.tools.js';
import { strayToolCall } from './stray.tool.call.js';

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

/** How much of a stray tool call is quoted when one is re-issued. Enough to see the shape. */
const STRAY_LOG_CHARS = 200;

/**
 * Why a conversation ended: whatever the provider reported, plus the one reason only the station can
 * give.
 *
 * **`'preempted'` exists because the wire vocabulary has no word for it and the nearest one is a
 * lie.** A generation the gate takes back is not a generation that hit its ceiling, but a provider
 * that was cut off mid-stream reports `length`, and for a long time this loop passed that straight
 * on with a `preempted` boolean beside it to correct the record. Two spellings of one fact, and the
 * corrective half was the one that got dropped: every log line and every `set-*.json` capture wrote
 * `finish` alone, so the on-disk record of a preempted refill was indistinguishable from a model
 * that ran out of room.
 *
 * That is not hypothetical and it has cost two diagnoses. A `classic banjo` refill preempted 4.6
 * seconds in was reported as `finish=length searches=0` and accused of not using its tools, when it
 * had asked to search and been cut off before the calls ran. And of the ten empty set captures that
 * survive on this install, every one says `length` and both that can still be attributed to a log
 * line were preemptions — while `DEFAULT_MAX_OUTPUT_TOKENS` was raised to 12,000 arguing from
 * exactly that shape. See `docs/todo/station-intelligence.md` §2.
 *
 * So the reason carries it. A caller that wants "did the model run out of room" asks for `'length'`
 * and gets an answer that is true, and a caller that logs the reason and nothing else — which is all
 * of them — reports what happened.
 */
export type ConversationFinishReason = LlmFinishReason | 'preempted';

/**
 * What a model is told when the loop has run out of steps.
 *
 * The tools are withdrawn on the last step so the model has to answer in words, and for as long as
 * that was ALL that happened it did not work: withdrawing a declaration is a silence, and this
 * station's model reads a silence as nothing at all. Measured on a briefed refill — five productive
 * searches, roughly two dozen usable records gathered, and then a final generation made with no
 * declarations that came back with no text and a `tool-calls` finish reason. It asked for a tool that
 * was not there and said nothing, spending the one step that existed for answering. The floor filled
 * the hour.
 *
 * So the step is spent on an instruction instead of a hint. Three things about the wording are
 * deliberate:
 *
 * - it names the CONSEQUENCE, because every rule in this codebase's prompts that works does. "There
 *   are no tools left" is a fact a model can note and ignore; "a reply that is not an answer ends
 *   this with nothing" is a reason;
 * - it says "the format you were asked for" rather than naming one, because this is the host and the
 *   format belongs to the caller. A set generator's system turn asks for a JSON array and a break
 *   writer's asks for a sentence, and a final turn that named either would be lying to the other;
 * - it says to use what it already has, since the failure is a model that HAS enough and reaches for
 *   more anyway.
 */
const FINAL_TURN =
    'That is all the searching you get: there are no tools left to call. Answer now, in the format you were asked for, using what you already have. A reply that asks for anything else ends this with nothing, and everything you found is thrown away.';

/**
 * What a model is told when it stopped without answering and still had steps left.
 *
 * The sibling of {@link FINAL_TURN} for the other end of the loop, and it must NOT say the tools are
 * gone, because they are not: the whole point is that the model may still search if searching is
 * what it meant to do. Measured shapes it answers, all from briefed refills that had already found
 * what they needed: an empty reply with two steps unspent, and `Need more. Let's fetch Lost Years.`
 * as the final message with three.
 *
 * It names both ways out, since the failure is a model that has fallen between them, and it names
 * the consequence, which is the half that makes a rule land rather than be noted.
 */
const NOT_AN_ANSWER =
    'That was not an answer. Either call a tool, or give your answer now in the format you were asked for, using what you already have. A reply that is neither ends this and everything you found is thrown away.';

/**
 * How many times one conversation is told that.
 *
 * ONE. A model that has been asked plainly and still cannot answer is not going to, and every further
 * attempt spends a step the caller's floor could have had instead — the same argument that bounds
 * everything else here. It is also what keeps a caller's `answersWith` from turning the loop into a
 * validation retry, which is the thing it must not become.
 */
const NUDGE_LIMIT = 1;

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

    /**
     * Who is asking, for the one model slot. Absent means `air`, which is every on-air writer.
     *
     * **This was silently dropped for as long as it existed anywhere.** `ModelTalkBreakWriter` has
     * always passed a `priority` down for a rehearsal, and `LlmCallOptions` had no such field and
     * neither {@link generateWith} nor {@link converse} forwarded one — a spread into an object
     * literal skips TypeScript's excess-property check, so it compiled and did nothing. The effect
     * was that `PersonaRehearsalService`'s promise never to outrank the station held at `SpeechGate`
     * and never once held at `LlmGate`, which is the gate that matters: a rehearsal is minutes of
     * generation and a sample is one short line.
     */
    priority?: GatePriority;

    /**
     * Leave the model's queue when this aborts, for work that stopped being wanted.
     *
     * Forwarded to `LlmGate` and bounding the QUEUE only; a generation already in flight is stopped
     * by its own budget. See `LlmGateOptions.signal`.
     */
    signal?: AbortSignal;
}

/** {@link LlmCallOptions}, plus what a conversation may do with tools. */
export interface LlmConverseOptions extends LlmCallOptions {
    /** Set `false` for a conversation that must not call anything. Absent means offer what there is. */
    tools?: boolean;

    /** Override {@link MAX_TOOL_STEPS} for one conversation. */
    maxToolSteps?: number;

    /**
     * Whether the model's words are an ANSWER, asked of the caller because only it can tell.
     *
     * The loop ends when a generation comes back with no tool calls, because that is what an answer
     * looks like. Measured on this station's model, it frequently is not: three briefed refills
     * ended with four good searches and then, in turn, a tool call written as text, an empty reply,
     * and a plan written as prose (`Need more. Let's fetch Lost Years.`). Every one was read as an
     * answer and every one cost the hour.
     *
     * The host can only judge the empty case, which is what the default does — blank is not an
     * answer under any caller's format. Everything else needs the caller: a set generator's answer is
     * a JSON array of records and a break writer's is a sentence, and prose that means nothing to the
     * first is exactly what the second is for. So a caller that can check hands the check over.
     *
     * Consulted only while steps REMAIN, and it buys one more step, once ({@link NUDGE_LIMIT}). It is
     * not a validator and must not be used as one: saying no does not reject the answer, it spends a
     * step asking again, and whatever comes back after that is what the caller gets. A model that
     * cannot answer twice is a model that is not going to.
     */
    answersWith?: (text: string) => boolean;
}

/**
 * What a conversation answers with: the model's own result, plus what the loop did to get it.
 *
 * An extension declared HERE rather than a change to `LlmResult`, which is a plugin-sdk payload
 * describing one generation. The tool loop is the host's, so what it did is the host's to report.
 *
 * {@link toolCallsMade} exists for a specific judgement a caller cannot otherwise make. `converse`
 * asks its last step without tools, so the returned `toolCalls` is empty on every successful
 * conversation and says nothing about whether the model drove its tools at all. That distinction
 * matters: a model that searched honestly and found nothing has told the truth about a thin
 * library, while a model that never searched and answered anyway is a model failing to use what it
 * was given. Only the second is worth counting against it.
 */
export interface LlmConversation extends Omit<LlmResult, 'finishReason'> {
    /**
     * What ended the conversation, in a vocabulary that can say the station did it.
     *
     * `LlmResult.finishReason` is the plugin SDK's and describes what a PROVIDER reported, so
     * `'preempted'` can never come from one and does not belong there. It is overridden here for the
     * same reason the two fields below are declared here: the loop is the host's, and so is the only
     * thing that knows a generation was abandoned rather than finished.
     */
    finishReason: ConversationFinishReason;
    /** How many tool calls the loop actually ran, across every step. */
    toolCallsMade: number;
    /**
     * Everything the model was SHOWN, in order: the caller's own turns, each assistant turn that
     * asked for a tool, and every tool result the loop fed back.
     *
     * The count above says how many searches happened and this says what they returned, which is
     * the difference between a diagnosable failure and a guess. A model that searched three times,
     * was handed thirty-six records and then named none is indistinguishable — from the count alone
     * — from one handed nothing, and the two want opposite fixes. That exact run cost a briefed hour.
     *
     * It stops before the final answer, deliberately: this is the conversation as the model last saw
     * it, and what it then said is {@link LlmResult.text} beside it. Handed back on every
     * conversation because it is the array the loop was building anyway, and it is nobody's business
     * to store — the one caller that reads it does so only while `llm.captureWrites` is on.
     */
    transcript: readonly LlmMessage[];
}

/** Fold one generation's usage into a conversation's running total. */
function addUsage(total: LlmUsage, step: LlmUsage | undefined): void {
    if (step === undefined) return;

    // A conversation is several generations and its cost is their sum, so a caller logging this sees
    // what the answer actually cost rather than what its last step did.
    if (step.inputTokens !== undefined) total.inputTokens = (total.inputTokens ?? 0) + step.inputTokens;
    if (step.outputTokens !== undefined) total.outputTokens = (total.outputTokens ?? 0) + step.outputTokens;
    if (step.totalTokens !== undefined) total.totalTokens = (total.totalTokens ?? 0) + step.totalTokens;

    // Both reasoning figures sum the same way and for the same reason: a conversation that spent
    // four steps thinking and answered on the fifth is one run of the model as far as any caller
    // reading this is concerned, and a per-step figure would understate it by however many searches
    // it took.
    if (step.reasoningTokens !== undefined) total.reasoningTokens = (total.reasoningTokens ?? 0) + step.reasoningTokens;
    if (step.reasoningChars !== undefined) total.reasoningChars = (total.reasoningChars ?? 0) + step.reasoningChars;
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
        return pluginsWith(this.pluginRegistry.list(), asLlmPlugin).sort(byPluginId);
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

        if (chosen === undefined) {
            this.logger.info(`llm: nothing to think with (${explainNoGenerator(candidates, configured)})`);
            return undefined;
        }

        // On the edge only, for `SpeechService.speaker`'s reason: an unset key picking rather than
        // refusing is only honest if the choice is said out loud, and only bearable if it is said
        // once.
        if (defaultPickIsNews(chosen, candidates, LLM_PLUGIN_KEY, configured)) {
            this.logger.info(`llm: ${explainDefaultGenerator(chosen, candidates)}`);
        }
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
                ...(options.priority === undefined ? {} : { priority: options.priority }),
                ...(options.signal === undefined ? {} : { signal: options.signal }),
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
     * And when the loop runs out of steps, the last generation is made with no tools at all AND is
     * told so ({@link FINAL_TURN}), so the model has to answer in words. Without the withdrawal a
     * caller can be handed a result whose only content is a request for a tool call nobody is going
     * to make, which reads downstream as the model having said nothing. Without the SENTENCE, the
     * same thing happens anyway: a withdrawn declaration is a silence, and a model that has been
     * searching does not read one.
     *
     * ## A tool call written as text is still a tool call
     *
     * Before the loop accepts a generation as an answer it asks whether the words ARE a call — a
     * bare `{"artist":"…","limit":12}` and nothing else — and re-issues one that is. A local model
     * does this instead of calling, and without the rescue the conversation ends on a question, one
     * step short of the answer it was about to give. `strayToolCall` holds the bar, which is high on
     * purpose. The rescue is not offered on the last step, where withdrawing the tools is the point.
     */
    async converse(request: LlmRequest, options: LlmConverseOptions = {}): Promise<LlmConversation> {
        const plugin = this.generator();
        if (plugin === undefined) throw new PluginError(`llm: ${this.explainGenerator()}`).withCode('unavailable');

        const maxSteps = options.maxToolSteps ?? MAX_TOOL_STEPS;
        const tools = await this.toolsFor(plugin, request, options);

        // Blank is not an answer under any caller's format, which is the whole of what the host can
        // judge on its own. Anything narrower is the caller's to say. See `answersWith`.
        const answers = options.answersWith ?? ((text: string) => text.trim().length > 0);

        return await this.gate.hold(async signal => await this.runConversation(plugin, request, tools, maxSteps, answers, signal), {
            budgetMs: options.budgetMs ?? GENERATION_BUDGET_MS,
            ...(options.maxWaitMs === undefined ? {} : { maxWaitMs: options.maxWaitMs }),
            ...(options.priority === undefined ? {} : { priority: options.priority }),
            ...(options.signal === undefined ? {} : { signal: options.signal }),
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
        answers: (text: string) => boolean,
        signal: AbortSignal,
    ): Promise<LlmConversation> {
        const declarations = [...tools.values()].map(tool => tool.declaration);
        const messages = [...request.messages];
        const usage: LlmUsage = {};
        let toolCallsMade = 0;
        let nudges = 0;

        for (let step = 0; ; step++) {
            // The last step is asked WITHOUT tools, so the model has to produce words rather than
            // ask for something nobody will run.
            const lastStep = step >= maxSteps;
            const offered = lastStep || declarations.length === 0 ? undefined : declarations;

            // And it is TOLD, because withdrawing the declarations does not say anything. See
            // {@link FINAL_TURN}: silently removing the tools is a signal this station's model does
            // not read, and it answers a step it could have used by asking for a tool that is not
            // there. Only for a model that has actually been using them — a conversation that never
            // called one is not being cut off and has nothing to be told.
            if (lastStep && toolCallsMade > 0) messages.push({ role: 'user', content: FINAL_TURN });

            let result: LlmResult;
            try {
                result = await this.generateOnce(plugin, { ...request, messages, ...(offered === undefined ? {} : { tools: offered }) }, signal);
            } catch (error) {
                // Preempted WHILE the model was speaking, which is the case the check further down
                // cannot reach: that one sits between two steps, and this is a generation abandoned
                // part-way through. The slot is what was being taken back, so coming back promptly
                // with nothing is the whole point — waiting for the words in order to return them
                // would hand the break that preempted this exactly the delay it preempted to avoid.
                if (!signal.aborted) throw error;

                this.logger.info('llm: a conversation was preempted mid-generation', {
                    plugin: plugin.record.id,
                    step,
                    searches: toolCallsMade,
                });
                // No text, because there is none: what the model had said so far belongs to a
                // generation nobody drained. The provider would report this as `length`; it is
                // reported as what it is, so that a caller telling it apart from a model with
                // nothing to say does not have to know to ask a second question. See
                // {@link ConversationFinishReason}.
                return { text: '', toolCalls: [], usage, toolCallsMade, transcript: messages, finishReason: 'preempted' };
            }
            addUsage(usage, result.usage);

            // The last step was asked for words, so words are what it gets to be. A model that asks
            // for a tool there — as a call or as text — is answered by ending the conversation,
            // which is the whole point of withdrawing the declarations.
            if (lastStep) {
                return { ...result, usage, toolCallsMade, transcript: messages };
            }

            // A tool call the model wrote as TEXT rather than as a call is still a tool call, and
            // ending here spends a whole generation on a question nobody answers. See
            // `strayToolCall`, which is deliberately hard to satisfy: a real answer must never be
            // mistaken for a search.
            const stray = result.toolCalls.length === 0 ? strayToolCall(result.text, tools, step) : undefined;
            if (stray !== undefined) {
                this.logger.info('llm: the model wrote a tool call as text; re-issuing it as the call it asked for', {
                    plugin: plugin.record.id,
                    step,
                    tool: stray.name,
                    // The raw text, because what a model does instead of calling a tool is a fact
                    // about the model and this line is the only place it survives.
                    said: result.text.trim().slice(0, STRAY_LOG_CHARS),
                });
            }

            const asked = stray === undefined ? result.toolCalls : [stray];
            if (asked.length === 0) {
                // It asked for nothing and said nothing the caller can use, with steps still in
                // hand. The loop's whole assumption is that no tool calls means an answer, and for
                // this station's model that is often just where it stopped — so it is asked once
                // more rather than taken at its word. The searches it already made are kept, which
                // is why this is a step and not a fresh conversation.
                if (nudges < NUDGE_LIMIT && !answers(result.text)) {
                    nudges += 1;
                    this.logger.info('llm: the model stopped without answering and had steps left; asking once more', {
                        plugin: plugin.record.id,
                        step,
                        searches: toolCallsMade,
                        said: result.text.trim().slice(0, STRAY_LOG_CHARS),
                    });
                    messages.push({ role: 'user', content: NOT_AN_ANSWER });
                    continue;
                }

                return { ...result, usage, toolCallsMade, transcript: messages };
            }

            if (signal.aborted) {
                // The budget went while the station was doing its own work. Answer with what the
                // model has said so far rather than throwing: a partial line is worth more to a
                // writer that can fall back than an exception is.
                //
                // Note where this sits: the step above produced tool calls (or the return before it
                // would have taken us), so what is being abandoned is a model that ASKED to search.
                // `toolCallsMade` therefore stays at whatever ran BEFORE this step, and a caller
                // reading 0 there is reading the station's interruption rather than an idle model —
                // which is why the finish reason is overridden here rather than passed through.
                this.logger.info('llm: a conversation ran out of budget mid-loop', {
                    plugin: plugin.record.id,
                    step,
                    // The number that says what was lost. A preemption at step 0 costs the whole
                    // refill; one at step 3 costs the answer and keeps the searching.
                    wanted: asked.length,
                });
                return { ...result, usage, toolCallsMade, transcript: messages, finishReason: 'preempted' };
            }

            // The assistant turn AND its calls, as one message. A model that cannot see its own
            // request has no idea what the results after it are answering.
            //
            // A rescued call goes in with EMPTY content rather than the text it was read out of.
            // The transcript is also the model's own record of what it just did, and showing it a
            // well-formed call is showing it the shape to repeat; showing it the loose object is
            // showing it the mistake. The text is not lost — the log line above quotes it.
            messages.push({ role: 'assistant', content: stray === undefined ? result.text : '', toolCalls: asked });

            for (const call of asked) {
                const answer = await this.tools.run(call, tools, signal);
                messages.push({ role: 'tool', toolCallId: call.id, content: answer });
                toolCallsMade += 1;
            }

            this.logger.debug('llm: ran tools for a conversation', { plugin: plugin.record.id, step, calls: asked.length });
        }
    }

    /**
     * One generation, drained, WITHOUT the gate.
     *
     * Private and ungated on purpose: its only caller is already holding the slot, and going through
     * `gate.run` from inside `gate.hold` would be a caller queueing behind itself.
     *
     * `signal` is the gate's, and passing it is what makes preemption mean anything here. The
     * timeout above bounds STARTING the generation and stops there, deliberately — a generation
     * legitimately outlives the call that returned its handle — so without a signal on the drain the
     * only bound on the words themselves is the model's own willingness to stop. That is minutes on
     * a slow host, and it is minutes during which the caller holds the one slot a break with a
     * ten-second patience is queued for. Cancelling reaches the plugin's own abort; see
     * `LlmHandle.text`.
     */
    private async generateOnce(plugin: LlmPlugin, request: LlmRequest, signal?: AbortSignal): Promise<LlmResult> {
        const handle = await this.pluginInvoker.invoke(plugin.record.id, 'llm.generate', async () => plugin.instance.generate(request), {
            timeoutMs: START_TIMEOUT_MS,
        });

        return await collectGeneration(handle, signal);
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
