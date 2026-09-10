import {
    Plugin,
    PluginError,
    configBaseUrl,
    configString,
    errorText,
    parseRows,
    readRowSecret,
    type LlmFinishReason,
    type LlmHandle,
    type LlmModelInfo,
    type LlmPluginInstance,
    type LlmRequest,
    type LlmResult,
    type LlmToolCall,
    type ConfigFieldOption,
} from '@deadair/plugin-sdk';
import { streamText } from 'ai';
import { abortWith, withCancel } from './llm.abort.js';
import { providerStateOf, splitSystemPrompt, toModelMessages, toToolSet } from './llm.messages.js';
import { describeModels, toolCapableModels } from './llm.models.js';
import {
    DEFAULT_REASONING_EFFORT,
    isReasoningEffortSetting,
    llmManifest,
    MODEL_CACHE_MS,
    MODEL_FAILURE_CACHE_MS,
    readProviderKind,
    type ReasoningEffortSetting,
} from './llm.manifest.js';
import { buildArms, missingCredential, OPENAI_COMPATIBLE_ADDRESSES, type ProviderRow } from './llm.arms.js';
import { qualify, readModelName } from './llm.names.js';
import type { ProviderArm } from './llm.provider.js';

export { llmManifest };

/** One `streamText` call in flight, and the controller that stops it. */
interface Attempt {
    stream: ReturnType<typeof streamText>;
    controller: AbortController;
}

/**
 * Words out of whichever kind of provider the operator chose.
 *
 * One plugin rather than one per provider, because everything here except the
 * transport is the same work whoever is answering: the stream whose cancellation
 * stops the generation, the one re-attempt without a thinking field, the answer
 * recovered out of a reasoning channel, the tool declarations that come back
 * unrun. `providerKind` picks an arm and the arm is deliberately small — see
 * `llm.provider.ts`, which says what an arm may and may not know.
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
    private model = '';
    private temperature?: number;
    private models = '';
    private reasoningEffort: ReasoningEffortSetting = DEFAULT_REASONING_EFFORT;

    /** Every provider the operator configured, by the name they gave it. See `llm.arms.ts`. */
    private arms: ReadonlyMap<string, ProviderArm> = new Map();

    /** Each provider's kind, for the sentences that have to say what a row is missing. */
    private kinds = new Map<string, ProviderRow['kind']>();

    /**
     * The arms that have refused the thinking field, for the rest of this load.
     *
     * A SET rather than a flag, and the difference is a real failure: a Gemini 2.5
     * model refusing `thinkingLevel` used to latch the whole plugin, so the next
     * break written on Claude went out with its thinking silently switched off. A
     * refusal is a fact about the provider that refused it, and two rows of the same
     * KIND are still two providers — one account's model saying no tells you nothing
     * about another's.
     *
     * Not config and not carried across a reload: a reconfigure may point an arm at
     * a different account entirely, and a strict model today says nothing about the
     * one an operator names tomorrow.
     */
    private readonly reasoningRefused = new Set<string>();

    /**
     * What each arm's model listing last said, and when. See {@link fetchModels}.
     *
     * `ok: false` is a failure remembered rather than a list: `ids` is empty and
     * `errorMessage` is what the arm said, kept only so a cached failure can be
     * rethrown with the reason a fresh probe would have given.
     */
    private readonly discovered = new Map<string, { at: number; ok: boolean; ids: string[]; errorMessage?: string }>();

    protected async onLoad(): Promise<void> {
        const config = await this.host.config.get();
        this.model = configString(config.model) ?? '';
        this.temperature = typeof config.temperature === 'number' ? config.temperature : undefined;
        this.models = typeof config.models === 'string' ? config.models : '';
        const configuredEffort = configString(config.reasoningEffort);
        this.reasoningEffort = isReasoningEffortSetting(configuredEffort) ? configuredEffort : DEFAULT_REASONING_EFFORT;
        this.reasoningRefused.clear();

        // Built once per load rather than per call: an arm is a closure over an
        // address, a key and the fetch, none of which change without a reload. A
        // reconfigure reinitializes the plugin, which runs this again.
        //
        // The credential comes from the secrets store rather than from the row, because a `secret`
        // column is never in the row — that is what makes it a secret rather than a JSON string
        // with a password in it. See `readRowSecret`.
        const rows: ProviderRow[] = [];
        for (const row of parseRows(config.providers)) {
            const apiKey = await readRowSecret(this.host, 'providers', row, 'apiKey');
            rows.push({
                name: row.name ?? '',
                kind: readProviderKind(row.kind),
                baseUrl: configBaseUrl(row.baseUrl),
                ...(apiKey === undefined ? {} : { apiKey }),
            });
        }

        this.arms = buildArms(this.host, rows);
        this.kinds = new Map(rows.map(row => [row.name.trim(), row.kind]));

        // Dropped rather than kept: the operator may have just pointed an arm
        // somewhere else, and a list from the old service is worse than no list.
        this.discovered.clear();

        this.host.logger.info('llm ready', { providers: [...this.arms.keys()].join(',') || 'none', model: this.model });
    }

    /**
     * Which providers can be reached, and what each of them has.
     *
     * Reports the models it found, because this is the ONLY way an operator can
     * learn them: a default model cannot be chosen before a credential is saved,
     * and a credential cannot be tested before it is saved either. So the loop has
     * to be "save the key, press test, read the names, choose one" — and that only
     * works if this says the names out loud.
     *
     * One line per configured arm, and every arm reported even when an earlier one
     * failed. A single line saying "connected" would be an answer about whichever
     * arm happened to be first, on a form that now configures three.
     */
    async testConnection(): Promise<{ ok: boolean; message: string }> {
        if (this.kinds.size === 0) return { ok: false, message: 'No providers are configured. Add one to the table below.' };

        const lines: string[] = [];
        const found: string[] = [];
        let reached = 0;

        // Every ROW, not every arm. A row that could not be built is the one an operator most needs
        // told about — it is the row they half filled in — and reporting only what was built would
        // answer "nothing is configured" to somebody looking at a table with three rows in it.
        for (const [provider, kind] of this.kinds) {
            if (!this.arms.has(provider)) {
                lines.push(`${provider}: ${missingCredential(kind)}.`);
                continue;
            }

            try {
                const ids = await this.fetchModels(provider);
                reached += 1;
                for (const id of ids) found.push(qualify(provider, id));
                lines.push(ids.length === 0 ? `${provider}: reached, but it listed no models.` : `${provider}: ${ids.length} model(s).`);
            } catch (error) {
                lines.push(`${provider}: ${errorText(error)}`);
            }
        }

        const message = lines.join(' ');

        // False only when NOTHING answered. One arm of three failing is worth reporting in
        // the sentence and is not a failed test: the station can still write on the other
        // two, and a red result would say otherwise.
        if (reached === 0) return { ok: false, message };

        if (this.model.length === 0) {
            return { ok: true, message: found.length === 0 ? message : `${message} Set one of them as the default model.` };
        }

        // v1 paid for this sentence: "connected" alone, with a model name that is not
        // installed, sends an operator looking at the network for a fault that is a typo.
        // The names themselves are not listed here any more — with three providers that is
        // a paragraph nobody reads, and the default model field is an autocomplete fed by
        // this same listing, which is where they are now learned.
        if (found.length > 0 && !found.includes(this.model)) {
            return { ok: true, message: `${message} But "${this.model}" is not one of them.` };
        }

        return { ok: true, message: `${message} Default model "${this.model}".` };
    }

    /**
     * What the settings form should offer, out of what the providers actually have.
     *
     * This is what makes the form fillable. Without it, the only way to learn a model name is to
     * read it out of a "Test connection" message and type it back, and the default model cannot be
     * chosen before a credential is saved anyway — a loop with no way in.
     *
     * The two model fields are answered differently, and the difference is the point. The default
     * model is offered every model across every provider, because it is the field that decides
     * which one an unnamed request reaches. The tool-capable models are offered only the models of
     * providers that cannot answer the tool question themselves, because a Claude model ticked in
     * that box would be an operator confirming something already known.
     *
     * Answers what it can rather than throwing when something is unreachable: an operator fixing a
     * bad address needs the form, and the refresh control is right there.
     */
    async suggestConfigOptions(): Promise<Record<string, ConfigFieldOption[]>> {
        // Offered whether or not anything can be reached, and per CELL rather than per field:
        // `providers.baseUrl` is the column key the console publishes a row's choices under. It is
        // also where an operator learns that OpenAI is one of these rather than a missing provider,
        // since a `url` cell with suggestions draws as free text plus a list.
        const suggestions: Record<string, ConfigFieldOption[]> = { 'providers.baseUrl': [...OPENAI_COMPATIBLE_ADDRESSES] };

        const described = await this.describeEveryArm();
        if (described.length > 0) {
            suggestions.model = described.map(entry => ({ value: entry.id, label: entry.label ?? entry.id }));

            const ticked = described.filter(entry => !this.answersToolsItself(entry.id));
            if (ticked.length > 0) suggestions.models = ticked.map(entry => ({ value: entry.id, label: entry.label ?? entry.id }));
        }

        return suggestions;
    }

    /** Whether the provider a qualified model belongs to says every one of its models takes tools. */
    private answersToolsItself(qualified: string): boolean {
        const named = readModelName(qualified);
        return named !== undefined && this.arms.get(named.provider)?.toolsOnEveryModel === true;
    }

    /**
     * Every model the station could name, across every configured provider.
     *
     * The ids come from the services, because they know them and the operator should
     * not have to type out what the machine can say. Where the tool flags come from
     * depends on the arm: a vendor whose own models all take tools says so, and an
     * OpenAI-compatible endpoint cannot, so there the flags come from config. See
     * `llm.models.ts`.
     *
     * A provider that cannot be reached contributes what config knows rather than
     * failing the list: a momentary blip should cost the console some rows, not the
     * station its ability to write.
     */
    async listModels(): Promise<LlmModelInfo[]> {
        return await this.describeEveryArm();
    }

    /**
     * {@link listModels}'s body, shared with the config suggestions so one round of listing serves
     * both.
     *
     * The arms are asked together rather than one after another: each can take
     * up to `PROBE_TIMEOUT_MS`, and a station with three configured is not worth
     * three of those in a row on every call. One promise per arm, each catching
     * its own failure rather than letting it reject: a listing failure must not
     * cost the OTHER arms their turn, and it must not cost ITS OWN arm its turn
     * at {@link describeModels} either: a provider config already trusts to have
     * a default model keeps offering it with an empty id list, exactly like the
     * answering arms, which is what a bare `Promise.allSettled` here would lose.
     * `Promise.all` still returns in the arms' own order regardless of which one
     * answered first, which is what keeps the output deterministic.
     */
    private async describeEveryArm(): Promise<LlmModelInfo[]> {
        const answers = await Promise.all(
            [...this.arms].map(async ([provider, arm]) => {
                try {
                    return { provider, arm, ids: await this.fetchModels(provider) };
                } catch (error) {
                    this.host.logger.debug("llm could not list a provider's models", { provider, error: errorText(error) });
                    return { provider, arm, ids: [] as string[] };
                }
            }),
        );

        const described: LlmModelInfo[] = [];
        for (const { provider, arm, ids } of answers) {
            // One describer for every kind now. What differs is only who answers the tool
            // question: a vendor serving its own models answers it, and an OpenAI-compatible
            // server cannot, so there it comes from the operator's ticked list.
            described.push(...describeModels(provider, ids, this.models, this.model, arm.toolsOnEveryModel));
        }

        return described;
    }

    /**
     * What one provider has, cached briefly: a success for {@link MODEL_CACHE_MS},
     * a failure for the much shorter {@link MODEL_FAILURE_CACHE_MS}.
     *
     * Cached because `listModels` is on the path of every conversation that might
     * use tools, and a round trip per break to learn something that changes when
     * an operator installs a model is a poor trade. A success is short enough that
     * pulling a new model shows up within a minute without a reload; a failure is
     * cached far more briefly, and still on purpose: a dead provider row should
     * cost one probe per window rather than a full timeout inside every slot that
     * asks in the meantime, but an operator who just fixed the row should not
     * wait a full minute to see it again.
     *
     * Per arm rather than one slot, because three providers answer at three speeds
     * and one shared entry would have whichever asked last evicting the rest.
     *
     * @throws {Error} with a sentence a console can show, for a provider that
     * refused or could not be reached: freshly, or replayed from the failure
     * cache within {@link MODEL_FAILURE_CACHE_MS}.
     */
    private async fetchModels(provider: string): Promise<string[]> {
        const arm = this.arms.get(provider);
        if (arm === undefined) throw new Error(`there is no provider called "${provider}"`);

        const cached = this.discovered.get(provider);
        if (cached !== undefined) {
            const age = Date.now() - cached.at;
            if (cached.ok && age < MODEL_CACHE_MS) return cached.ids;
            if (!cached.ok && age < MODEL_FAILURE_CACHE_MS) throw new Error(cached.errorMessage ?? `provider "${provider}" could not be reached`);
        }

        try {
            const ids = await arm.fetchModels();
            this.discovered.set(provider, { at: Date.now(), ok: true, ids });
            return ids;
        } catch (error) {
            this.discovered.set(provider, { at: Date.now(), ok: false, ids: [], errorMessage: errorText(error) });
            throw error;
        }
    }

    async generate(request: LlmRequest): Promise<LlmHandle> {
        const asked = configString(request.model) ?? this.model;
        if (asked.length === 0) throw new PluginError('the model plugin has no model configured and none was asked for').withCode('config');

        // Which provider, read off the name. The one place that decision is made, so a caller
        // naming `claude:sonnet` reaches the row called `claude` whatever else is configured.
        // See `llm.names.ts`.
        const named = readModelName(asked);
        if (named === undefined) {
            throw new PluginError(`"${asked}" does not name a provider; models are named provider:model`).withCode('config');
        }

        const { provider, id: model } = named;
        const arm = this.arms.get(provider);
        if (arm === undefined) {
            // Two different repairs, and they read differently on the form: a row that is not
            // there at all, and a row that is there without what its kind needs.
            const kind = this.kinds.get(provider);
            const because = kind === undefined ? 'there is no provider by that name' : missingCredential(kind);
            throw new PluginError(`"${asked}" cannot be reached: ${because}`).withCode('config');
        }

        if (request.messages.length === 0) throw new PluginError('a generation needs at least one message').withCode('config');

        this.assertCanUseTools(request, arm, asked);

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
            const reasoning = effortField === undefined ? undefined : arm.reasoningOptions(effortField);

            // Aborted when the host cancels the text stream, and linked to the invocation signal so
            // that being abandoned before the first chunk still stops the request.
            const controller = new AbortController();
            abortWith(this.host.signal, controller);

            const stream = streamText({
                model: arm.languageModel(model),
                ...(system === undefined ? {} : { system }),
                messages: toModelMessages(rest),
                ...(temperature === undefined ? {} : { temperature }),
                ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
                ...(tools === undefined ? {} : { tools }),
                // Unset unless the setting or the caller's own hint asks for it, and in whatever
                // this service calls thinking. See `effortToSend` and the arm's own
                // `reasoningOptions`.
                ...(reasoning === undefined ? {} : { providerOptions: reasoning }),
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

        const firstEffort = this.effortToSend(provider, request.reasoningEffort);
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
            text: withCancel(streamFromGenerator(this.driveText(provider, first, firstEffort, buildAttempt, active, resolveResult)), () =>
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
        provider: string,
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

                if (part.type === 'error' && retriable && this.arms.get(provider)?.isReasoningRefusal(part.error) === true) {
                    retriable = false;
                    this.reasoningRefused.add(provider);
                    this.host.logger.warn('llm: the provider refused the thinking field; retrying once without it', {
                        provider,
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
     * `undefined` once {@link reasoningRefused} has latched FOR THIS ARM: a provider that rejected
     * the field once gets it dropped for the rest of this plugin's life, regardless of what a later
     * caller asks for or how this is configured. Only that provider — one arm refusing says nothing
     * about the others, and latching them together would silently switch thinking off on a model
     * that had never refused anything.
     */
    private effortToSend(provider: string, hint: LlmRequest['reasoningEffort']): string | undefined {
        if (this.reasoningRefused.has(provider)) return undefined;

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
    private assertCanUseTools(request: LlmRequest, arm: ProviderArm, model: string): void {
        if (request.tools === undefined || request.tools.length === 0) return;

        // A vendor whose models all take tools has already answered this, and asking the
        // operator to tick a box confirming it is asking them to know something the arm knows.
        if (arm.toolsOnEveryModel) return;

        // Read from config alone rather than through `describeModels`, so this stays
        // synchronous and cannot be fooled by a listing blip: a model the provider did not
        // list this second is still one the operator ticked. Compared QUALIFIED, because one
        // station has several providers and the same bare name on two of them is two models.
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
