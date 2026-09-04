import {
    Plugin,
    PluginError,
    configBaseUrl,
    configString,
    errorText,
    jsonBody,
    type LlmFinishReason,
    type LlmHandle,
    type LlmModelInfo,
    type LlmPluginInstance,
    type LlmRequest,
    type LlmResult,
    type LlmToolCall,
    type ConfigFieldOption,
} from '@deadair/plugin-sdk';
import { createOpenAICompatible, type OpenAICompatibleProvider } from '@ai-sdk/openai-compatible';
import { APICallError, streamText } from 'ai';
import { hostFetch } from './llm.fetch.js';
import { abortWith, withCancel } from './llm.abort.js';
import { providerStateOf, splitSystemPrompt, toModelMessages, toToolSet } from './llm.messages.js';
import { describeModels, toolCapableModels } from './llm.models.js';
import {
    DEFAULT_REASONING_EFFORT,
    isReasoningEffortSetting,
    llmManifest,
    MODEL_CACHE_MS,
    PROBE_TIMEOUT_MS,
    PROVIDER_NAME,
    type ReasoningEffortSetting,
} from './llm.manifest.js';

export { llmManifest };

/** One `streamText` call in flight, and the controller that stops it. */
interface Attempt {
    stream: ReturnType<typeof streamText>;
    controller: AbortController;
}

/**
 * Words out of any OpenAI-compatible endpoint.
 *
 * One plugin rather than one per provider, because the AI SDK is already the
 * provider abstraction: `createOpenAICompatible` reaches a local Ollama, OpenAI,
 * vLLM and most hosted providers behind a single base URL, and a native adapter
 * for something with its own protocol slots in behind the `providerKind`
 * discriminator without the host noticing.
 *
 * ## The words are a stream, and that is load-bearing
 *
 * `generate` starts the request and hands back the SDK's own token stream, so a
 * long answer is words in flight rather than a string held whole. More
 * importantly it is how the host knows when a generation really ended: it holds
 * its single model slot until the stream drains, and releasing when the call
 * resolved would let two generations overlap on one local model and slow both.
 *
 * ## Tools come back, they do not get run
 *
 * The tool set this builds is deliberately execute-less, so the SDK returns each
 * call instead of performing it. Running them is the host's job. See
 * `llm.messages.ts`, which is where that decision is enforced.
 */
export class LlmPlugin extends Plugin implements LlmPluginInstance {
    private baseUrl = '';
    private apiKey?: string;
    private model = '';
    private temperature?: number;
    private models = '';
    private provider?: OpenAICompatibleProvider;
    private reasoningEffort: ReasoningEffortSetting = DEFAULT_REASONING_EFFORT;

    /**
     * Set for the rest of this load once a server has answered 400 naming
     * `reasoning_effort`. Not config, and not carried across a reload: a
     * reconfigure may point this at a different server entirely, and a strict
     * server today says nothing about tomorrow's.
     */
    private reasoningRefused = false;

    /** What `/models` last said, and when. See {@link fetchModels}. */
    private discovered?: { at: number; ids: string[] };

    protected async onLoad(): Promise<void> {
        const config = await this.host.config.get();
        this.baseUrl = configBaseUrl(config.baseUrl);
        this.model = configString(config.model) ?? '';
        this.temperature = typeof config.temperature === 'number' ? config.temperature : undefined;
        this.models = typeof config.models === 'string' ? config.models : '';
        const configuredEffort = configString(config.reasoningEffort);
        this.reasoningEffort = isReasoningEffortSetting(configuredEffort) ? configuredEffort : DEFAULT_REASONING_EFFORT;
        this.reasoningRefused = false;
        this.apiKey = await this.host.secrets.get('apiKey');

        // Built once per load rather than per call: it is a closure over the base
        // URL, the key and the fetch, none of which change without a reload. A
        // reconfigure reinitializes the plugin, which runs this again.
        this.provider =
            this.baseUrl.length === 0
                ? undefined
                : createOpenAICompatible({
                      name: PROVIDER_NAME,
                      baseURL: this.baseUrl,
                      ...(this.apiKey === undefined ? {} : { apiKey: this.apiKey }),
                      // Sends `stream_options: { include_usage: true }`. Without it a streaming
                      // response carries no token counts at all — measured against Ollama, which
                      // answers with usage only when asked — and `LlmResult.usage` comes back
                      // empty, which is the one thing that makes what a break cost observable.
                      includeUsage: true,
                      // The whole reason this is safe to point at an operator-supplied
                      // address. Everything the SDK sends goes through the host's fetch,
                      // so the allowlist, the per-upstream rate limit, the redirect
                      // re-check and the body bounds all apply to a model call exactly as
                      // they do to anything else. A plugin reaching for global fetch here
                      // would quietly opt out of all four. See `llm.fetch.ts`.
                      fetch: hostFetch(this.host),
                  });

        // Dropped rather than kept: the operator may have just pointed this
        // somewhere else, and a list from the old server is worse than no list.
        this.discovered = undefined;

        this.host.logger.info('llm ready', { baseUrl: this.baseUrl, model: this.model });
    }

    /**
     * Whether this can be reached, and what it has.
     *
     * Reports the models it found, because this is the ONLY way an operator can
     * learn them: a default model cannot be chosen before the server URL is
     * saved, and the URL cannot be tested before it is saved either. So the loop
     * has to be "save the address, press test, read the names, choose one" — and
     * that only works if this says the names out loud.
     */
    async testConnection(): Promise<{ ok: boolean; message: string }> {
        if (this.baseUrl.length === 0) return { ok: false, message: 'No server URL set.' };

        let models: string[];
        try {
            models = await this.fetchModels();
        } catch (error) {
            return { ok: false, message: errorText(error) };
        }

        if (models.length === 0) {
            return { ok: true, message: 'Connected, but the server listed no models.' };
        }

        const listed = models.join(', ');
        if (this.model.length === 0) {
            return { ok: true, message: `Connected. ${models.length} model(s) available: ${listed}. Set one as the default model.` };
        }

        // v1 paid for this sentence: "connected" alone, with a model name that is
        // not installed, sends an operator looking at the network for a fault that
        // is a typo.
        if (!models.includes(this.model)) {
            return { ok: true, message: `Connected, but "${this.model}" is not one of them. Available: ${listed}.` };
        }

        return { ok: true, message: `Connected. Default model "${this.model}". ${models.length} available.` };
    }

    /**
     * What the settings form should offer, out of what the server actually has.
     *
     * This is what makes the form fillable. Without it, the only way to learn a model name is to
     * read it out of a "Test connection" message and type it back, and the default model cannot be
     * chosen before the address is saved anyway — a loop with no way in.
     *
     * Both fields get the same list and use it differently: the default model is free text with
     * these as suggestions, so a model behind a proxy that does not list it stays typeable, and the
     * tool-capable models are ticked from it, because that answer only means anything about models
     * that exist.
     *
     * Answers nothing rather than throwing when the server is unreachable: an operator fixing a bad
     * address needs the form, and the refresh control is right there.
     */
    async suggestConfigOptions(): Promise<Record<string, ConfigFieldOption[]>> {
        let ids: string[];
        try {
            ids = await this.fetchModels();
        } catch (error) {
            this.host.logger.debug('llm could not suggest models', { error: errorText(error) });
            return {};
        }

        if (ids.length === 0) return {};

        const options = ids.map(id => ({ value: id, label: id }));
        return { model: options, models: options };
    }

    /**
     * The models this server has, annotated with which accept tools.
     *
     * The ids come from the server, because it knows them and the operator should
     * not have to type out what the machine can say. The tool flags come from
     * config, because no OpenAI-compatible endpoint reports tool support and it
     * cannot be inferred from a name. See `llm.models.ts`.
     *
     * A server that cannot be reached answers from config alone rather than
     * throwing: a momentary blip should cost the console its list, not the
     * station its ability to write.
     */
    async listModels(): Promise<LlmModelInfo[]> {
        let discovered: string[];
        try {
            discovered = await this.fetchModels();
        } catch (error) {
            this.host.logger.debug('llm could not list models', { error: errorText(error) });
            discovered = [];
        }

        return describeModels(discovered, this.models, this.model);
    }

    /**
     * `GET /models`, cached briefly.
     *
     * Cached because `listModels` is on the path of every conversation that might
     * use tools, and a round trip per break to learn something that changes when
     * an operator installs a model is a poor trade. Short enough that pulling a
     * new model shows up within a minute without a reload.
     *
     * @throws {Error} with a sentence a console can show, for a server that
     * refused or could not be reached.
     */
    private async fetchModels(): Promise<string[]> {
        const cached = this.discovered;
        if (cached !== undefined && Date.now() - cached.at < MODEL_CACHE_MS) return cached.ids;

        const response = await this.host.fetch(`${this.baseUrl}/models`, { headers: this.authHeaders(), timeoutMs: PROBE_TIMEOUT_MS });
        if (!response.ok) {
            await response.body?.cancel().catch(() => {});
            throw new Error(`Server answered HTTP ${response.status}.`);
        }

        const body = await jsonBody<{ data?: { id?: unknown }[] }>(response);
        const ids = (body?.data ?? []).map(entry => (typeof entry.id === 'string' ? entry.id.trim() : '')).filter(id => id.length > 0);

        this.discovered = { at: Date.now(), ids };
        return ids;
    }

    async generate(request: LlmRequest): Promise<LlmHandle> {
        const provider = this.provider;
        if (provider === undefined) throw new PluginError('the model plugin has no server URL configured').withCode('config');

        const model = configString(request.model) ?? this.model;
        if (model.length === 0) throw new PluginError('the model plugin has no model configured and none was asked for').withCode('config');

        if (request.messages.length === 0) throw new PluginError('a generation needs at least one message').withCode('config');

        this.assertCanUseTools(request, model);

        const temperature = request.temperature ?? this.temperature;
        const tools = toToolSet(request.tools);

        // Hoisted out of the message list rather than left in it: the SDK takes a system prompt as
        // its own option, and warns about one inline because later content can imitate a system
        // turn more easily than it can imitate a separate field.
        const { system, rest } = splitSystemPrompt(request.messages);

        // One attempt, with or without the effort field. Building it is cheap and side-effect-free
        // until something reads the stream, which is what lets the fallback below build a second one
        // only if the first is refused.
        const buildAttempt = (effortField: string | undefined): Attempt => {
            // Aborted when the host cancels the text stream, and linked to the invocation signal so
            // that being abandoned before the first chunk still stops the request.
            const controller = new AbortController();
            abortWith(this.host.signal, controller);

            const stream = streamText({
                model: provider.chatModel(model),
                ...(system === undefined ? {} : { system }),
                messages: toModelMessages(rest),
                ...(temperature === undefined ? {} : { temperature }),
                ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
                ...(tools === undefined ? {} : { tools }),
                // Unset unless the setting or the caller's own hint asks for it. See `effortToSend`.
                ...(effortField === undefined ? {} : { providerOptions: { [PROVIDER_NAME]: { reasoningEffort: effortField } } }),
                // The host already runs the one server-sanctioned retry, on a 429 or 503 carrying
                // `Retry-After` (`plugin.host.factory.ts`). A second layer underneath it multiplied a
                // throttled or failing provider's load by however many times the SDK retried on its
                // own, silently: nothing was logged, only the terminal error surfaced. It is also
                // what makes a refusal arrive below as `APICallError` rather than the SDK's own
                // `RetryError` wrapping it: unwrapped, the status code and the body are still on it.
                maxRetries: 0,
                // This plugin's OWN abort, deliberately not `host.signal`.
                //
                // The invocation signal is the right bound on STARTING a generation and the wrong one
                // for running it: `PluginInvoker` disposes that controller the moment `generate`
                // resolves, and `generate` resolves as soon as the request is away. So a generation —
                // which legitimately outlives the call that started it — had no live signal on it at
                // all, and nothing the host did could stop it. A refill holding the one model slot
                // therefore ran to completion however long it took, while a break with a ten-second
                // patience gave up and went to the floor: the exact failure the gate's preemption was
                // built to prevent, still happening because the abort had nowhere to land.
                abortSignal: controller.signal,
            });

            return { stream, controller };
        };

        const firstEffort = this.effortToSend(request.reasoningEffort);
        const first = buildAttempt(firstEffort);

        // What `withCancel`'s own abort reaches: the currently active attempt, which the fallback
        // below swaps out from under it the moment a refusal is caught. Cancelling the handle before
        // that happens must still stop the right request.
        const active = { controller: first.controller };

        let resolveResult!: (result: Promise<LlmResult> | LlmResult) => void;
        const result = new Promise<LlmResult>(resolve => {
            resolveResult = resolve;
        });

        this.host.logger.debug('llm generating', { model, messages: request.messages.length, tools: request.tools?.length ?? 0 });

        return {
            // Cancelling this is what stops the generation, per `LlmHandle.text`. Forwarding a
            // `textStream` alone would not: it is one branch of a tee, so closing it leaves the
            // other branch — which `resultOf` reads — pulling the provider regardless. `driveText`
            // reads through this same reader, so cancelling it here reaches the real one too.
            text: withCancel(streamFromGenerator(this.driveText(first, firstEffort, buildAttempt, active, resolveResult)), () =>
                active.controller.abort(),
            ),
            // Built here rather than awaited, so `generate` returns as soon as the request is away.
            // Resolved by `driveText` with whichever attempt's own result won: the first, unless a
            // refusal sent it chasing a second one before any words arrived.
            result,
        };
    }

    /**
     * The text half of {@link generate}, and the one place the effort fallback lives.
     *
     * Reads `first.stream.fullStream` rather than `textStream`, and that is not a style choice: with
     * `maxRetries: 0`, a `doStream` fault never reaches a consumer as a rejection at all.
     * `textStream`'s own transform forwards only `text-delta` parts and silently drops everything
     * else, an `error` part included, so a refusal closes it as an ordinary empty stream — and by
     * then the SDK's own step recorder has already flushed with nothing recorded, which is what
     * `resultOf` sees: a generic `NoOutputGeneratedError` with no trace of the 400 or its body.
     * `fullStream` is the one place the original fault is still attached to an `error` part, so this
     * reads it directly and filters `text-delta` out by hand — the same thing `textStream` does
     * internally.
     *
     * `retriable` is true only for the very first part read off `first`, and only when an effort
     * field actually went out on it; it is spent the moment a retry fires, so a second refusal on the
     * fallback attempt is surfaced rather than chased. `commit` fixes which attempt `resolveResult`
     * answers from — the first, unless a refusal sends it chasing a second one before any words or
     * any other fault arrived — and runs at most once.
     */
    private async *driveText(
        first: Attempt,
        firstEffortSent: string | undefined,
        buildAttempt: (effortField: string | undefined) => Attempt,
        active: { controller: AbortController },
        resolveResult: (result: Promise<LlmResult> | LlmResult) => void,
    ): AsyncGenerator<string, void, unknown> {
        let current = first;
        let reader = current.stream.fullStream.getReader();
        let retriable = firstEffortSent !== undefined;
        let committed = false;

        const commit = (): void => {
            if (committed) return;
            committed = true;
            resolveResult(this.resultOf(current.stream, current.controller));
        };

        try {
            for (;;) {
                let next;
                try {
                    next = await reader.read();
                } catch (error) {
                    commit();
                    throw error;
                }
                if (next.done) break;

                const part = next.value;

                if (part.type === 'text-delta') {
                    commit();
                    yield part.text;
                    continue;
                }

                if (part.type === 'error' && retriable && isReasoningEffortRefusal(part.error)) {
                    retriable = false;
                    this.reasoningRefused = true;
                    this.host.logger.warn('llm: the server refused reasoning_effort; retrying once without it', {
                        error: errorText(part.error),
                    });

                    current = buildAttempt(undefined);
                    active.controller = current.controller;
                    reader = current.stream.fullStream.getReader();
                    continue;
                }

                if (part.type === 'error') commit();
            }

            // Reached with nothing committed when a turn produced no text and no error at all —
            // tool calls with nothing said, which `resultOf`'s own empty-answer handling covers.
            commit();
        } finally {
            // Releases whichever branch is currently held, whether that is because the reader ran to
            // completion or because the handle was cancelled early. Safe either way: cancelling an
            // already-closed reader is a no-op, and this is not what stops the request — `active`
            // aborting the right controller is.
            await reader.cancel().catch(() => {});
        }
    }

    /**
     * What `reasoning_effort` should actually carry, given the setting and the caller's own hint.
     *
     * `undefined` once {@link reasoningRefused} has latched: a strict server that rejected the field
     * once gets it dropped for the rest of this plugin's life, regardless of what a later caller asks
     * for or how this is configured.
     */
    private effortToSend(hint: LlmRequest['reasoningEffort']): string | undefined {
        if (this.reasoningRefused) return undefined;

        switch (this.reasoningEffort) {
            case 'off':
                // The value a reasoning model reads as "answer without reasoning". Omitting the
                // field instead would leave the provider's own default in charge.
                return 'none';
            case 'auto':
                return hint;
            default:
                return this.reasoningEffort;
        }
    }

    /**
     * Refuse tools the named model was not declared able to take.
     *
     * The host already checks this and should never send them, so reaching here
     * means the two disagree. Failing loudly is right: the alternative is
     * dropping them silently, and a break written without the facts a tool would
     * have supplied reads as confidently wrong rather than as a failure anyone
     * notices.
     */
    private assertCanUseTools(request: LlmRequest, model: string): void {
        if (request.tools === undefined || request.tools.length === 0) return;

        // Read from config alone rather than through `describeModels`, so this
        // stays synchronous and cannot be fooled by a `/models` blip: a model the
        // server did not list this second is still one the operator ticked.
        if (toolCapableModels(this.models).includes(model)) return;

        throw new PluginError(`model "${model}" is not marked as able to use tools; tick it under the plugin's tool-capable models`).withCode(
            'unsupported',
        );
    }

    /** The SDK's several settled promises, as the one result the station's boundary describes. */
    private async resultOf(stream: ReturnType<typeof streamText>, controller: AbortController): Promise<LlmResult> {
        let settled;
        try {
            settled = await Promise.all([stream.text, stream.reasoningText, stream.content, stream.toolCalls, stream.usage, stream.finishReason]);
        } catch (error) {
            // A generation the host stopped is not a fault, and every one of the promises above
            // rejects when the request is aborted. Reported as `unavailable` rather than passed on
            // as whatever the SDK threw, because the caller asked for this and the alternative is a
            // deliberate stop arriving looking like a broken model server.
            if (controller.signal.aborted) throw new PluginError('the generation was stopped before it finished').withCode('unavailable');
            throw error;
        }

        const [text, reasoningText, content, toolCalls, usage, finishReason] = settled;

        // An answer with no words in it is worth describing rather than passing on as an empty
        // string, because every cause looks identical from the caller: a model that had nothing to
        // say, one that spent its allowance thinking, and one that put its answer somewhere this
        // does not read. The part types are what tell them apart, and they are only visible here.
        if (text.trim().length === 0 && toolCalls.length === 0) {
            this.host.logger.debug('llm: the model answered with no text', {
                finishReason,
                parts: content.map(part => part.type).join(','),
                reasoningChars: reasoningText?.length ?? 0,
            });
        }

        // Read off `content` rather than off the tool calls alone, because the reasoning
        // half only exists as parts: `stream.reasoningText` is the text with the
        // signatures already thrown away, and the signature is the whole point.
        const providerState = providerStateOf(content);

        const spoken = spokenAnswer({ text, reasoningText, toolCalls: toolCalls.length, finishReason });
        if (spoken !== text) {
            this.host.logger.debug('llm: the answer arrived as reasoning rather than text; using it', {
                reasoningChars: spoken.length,
                finishReason,
            });
        }

        return {
            text: spoken,
            toolCalls: toolCalls.map((call): LlmToolCall => ({
                id: call.toolCallId,
                name: call.toolName,
                // The SDK has already parsed the model's JSON. A call whose arguments
                // are not an object is the model being wrong rather than this being
                // broken, so it travels as an empty one and the host's own check on
                // the declared schema is what reports it.
                arguments: isRecord(call.input) ? call.input : {},
            })),
            usage: {
                ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
                ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
                ...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
                ...(usage.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
                // Measured here rather than left to the host, because this is the only
                // place the reasoning text exists: it is already read for the two debug
                // lines above and never crosses the boundary as text. A server that does
                // not count reasoning tokens still streams the reasoning, so this is the
                // field that answers where the allowance went on the station's own host.
                ...(reasoningText === undefined ? {} : { reasoningChars: reasoningText.length }),
            },
            finishReason: toFinishReason(finishReason),
            // Only where the provider signed something. See `providerStateOf`: an
            // OpenAI-compatible server signs nothing, so this field never appears on
            // one and the transcript the host builds is byte-identical to before.
            ...(providerState === undefined ? {} : { providerState }),
        };
    }

    private authHeaders(): Record<string, string> {
        return this.apiKey === undefined || this.apiKey.length === 0 ? {} : { authorization: `Bearer ${this.apiKey}` };
    }
}

/** One turn's several text-bearing fields, as {@link spokenAnswer} judges them. */
export interface SpokenCandidates {
    /** What the SDK collected as text content. */
    text: string;
    /** What it collected as reasoning, if the model reasons at all. */
    reasoningText?: string;
    /** How many tools the model asked for on this turn. */
    toolCalls: number;
    finishReason: string;
}

/**
 * What the model actually SAID this turn, out of the several places it may have put it.
 *
 * Pure and exported so the judgement is testable without a model, which matters more here than it
 * looks: every branch below was discovered by watching one, and each is one live run apart.
 *
 * ## Why a reasoning channel is ever read as an answer
 *
 * Measured against gpt-oss on Ollama, 2026-08-12. On the turn where that model finally ANSWERS
 * after a tool round, it puts the answer in the reasoning channel and leaves the text content
 * empty — so `stream.text` is `''` and the caller is handed something indistinguishable from a
 * model with nothing to say. The same model answers normally when no tools were offered, which is
 * why nothing noticed for as long as the only caller passed `tools: false`.
 *
 * ## The two guards, both of which cost a run to find
 *
 * **A turn that asked for a tool is never recovered from.** Its reasoning is working-out rather
 * than a reply, and promoting it feeds the model's own thoughts back as the assistant's words on
 * the next step.
 *
 * **`tool-calls` disqualifies even with no calls attached.** Asked for a final answer with no tools
 * offered, gpt-oss still finishes this way when what it WANTED was another search, and its
 * reasoning then reads "Need more variety. Search for rock." Handing that back is worse than an
 * empty string, because it looks like an answer.
 *
 * **`length` disqualifies too, and this one was found by a caller that had been broken for its whole
 * life.** A model that runs out of allowance before it finishes THINKING has produced no answer at
 * all — what is in the reasoning channel is a sentence cut off mid-word. The station's fact verifier
 * was calling with `maxOutputTokens: 8`, and every call came back `finishReason=length` with 17 to
 * 27 characters of truncated reasoning, which this promoted to an answer; the verifier then read it,
 * failed to find "yes" at the front, and rejected the claim. The model half of fact extraction wrote
 * nothing for as long as it existed, and nothing looked broken, because a wrong answer was being
 * manufactured out of a failure. An empty string would have been loud.
 *
 * Text always wins where there is any, so a provider that reasons and then answers is untouched:
 * its reasoning is not its answer, and the fallback is reached only where there is no answer at all.
 */
export function spokenAnswer({ text, reasoningText, toolCalls, finishReason }: SpokenCandidates): string {
    if (!isEmptyAnswer(text)) return text;
    if (toolCalls > 0 || finishReason === 'tool-calls') return text;
    if (finishReason === 'length') return text;
    if ((reasoningText?.trim().length ?? 0) === 0) return text;

    return reasoningText!;
}

/**
 * Whether a turn said anything, where an EMPTY CONTAINER counts as nothing.
 *
 * The widening that `''` alone missed, and it cost an hour of a briefed station. Asked for two
 * dozen records after three searches that returned thirty-six, gpt-oss answered `[]` — the same
 * failure as the empty text above with a bracket pair in front of it, since a model that puts its
 * answer in the reasoning channel still has to emit SOMETHING as the final content. From the
 * caller that is a model declining to programme, so the deterministic floor filled the hour and
 * the operator got a set with nothing to do with what they asked for.
 *
 * Only the containers a "there is nothing here" answer takes: an empty array, an empty object, an
 * empty string, and any of those inside a code fence. Never prose — a model that wrote a sentence
 * said something, even if the something was a refusal, and promoting its reasoning over that would
 * be overruling an answer rather than finding one.
 *
 * The risk this takes is worth naming: reasoning contains records the model CONSIDERED, so what is
 * recovered may include ones it went on to reject. Every pick still passes the rotation rules and
 * the bans at `PickResolver`, so the cost of a bad one is a single record; the cost of reading `[]`
 * as an answer is the whole set.
 */
function isEmptyAnswer(text: string): boolean {
    const bare = text
        .trim()
        .replace(/^```[a-z]*\s*/i, '')
        .replace(/```$/, '')
        .trim();

    return bare.length === 0 || bare === '[]' || bare === '{}' || bare === '""';
}

/**
 * The SDK's finish reason as the station's.
 *
 * They agree on everything except `unknown`, which the station does not have a
 * word for and which means the same thing as `other` to anybody acting on it.
 */
function toFinishReason(reason: string): LlmFinishReason {
    switch (reason) {
        case 'stop':
        case 'length':
        case 'tool-calls':
        case 'content-filter':
        case 'error':
            return reason;
        default:
            return 'other';
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * An async generator, as a `ReadableStream`.
 *
 * Not `ReadableStream.from`: the DOM lib this repo builds against does not declare it, though the
 * runtime has it. Written by hand instead, in the same shape `withCancel` already uses in
 * `llm.abort.ts`: `pull` drives the generator one step at a time and errors the stream on a
 * rejection rather than leaving that to the platform, and `cancel` calls the generator's own
 * `return`, which runs whatever `finally` block it has exactly as a `for await` loop breaking early
 * would.
 */
function streamFromGenerator<T>(generator: AsyncGenerator<T, void, unknown>): ReadableStream<T> {
    return new ReadableStream<T>({
        async pull(controller) {
            try {
                const { done, value } = await generator.next();
                if (done) {
                    controller.close();
                    return;
                }
                controller.enqueue(value);
            } catch (error) {
                controller.error(error);
            }
        },
        async cancel() {
            await generator.return(undefined).catch(() => undefined);
        },
    });
}

/**
 * Whether a fault is a strict server saying it does not know `reasoning_effort`, rather than any
 * other way a generation can fail. `maxRetries: 0` is why this arrives as `APICallError` rather than
 * the SDK's own `RetryError` wrapping it: unwrapped, the status code and the response body it
 * quotes are still on it.
 */
function isReasoningEffortRefusal(error: unknown): boolean {
    return APICallError.isInstance(error) && error.statusCode === 400 && /reasoning_effort/.test(error.responseBody ?? '');
}
