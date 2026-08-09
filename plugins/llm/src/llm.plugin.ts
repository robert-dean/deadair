import {
    jsonBody,
    Plugin,
    PluginError,
    type LlmFinishReason,
    type LlmHandle,
    type LlmModelInfo,
    type LlmPluginInstance,
    type LlmRequest,
    type LlmResult,
    type LlmToolCall,
} from '@deadair/plugin-sdk';
import { createOpenAICompatible, type OpenAICompatibleProvider } from '@ai-sdk/openai-compatible';
import { streamText } from 'ai';
import { hostFetch } from './llm.fetch.js';
import { toModelMessages, toToolSet } from './llm.messages.js';
import { describeModels, parseModelList } from './llm.models.js';
import { llmManifest, MODEL_CACHE_MS, PROBE_TIMEOUT_MS, PROVIDER_NAME } from './llm.manifest.js';

export { llmManifest };

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

    /** What `/models` last said, and when. See {@link fetchModels}. */
    private discovered?: { at: number; ids: string[] };

    protected async onLoad(): Promise<void> {
        const config = await this.host.config.get();
        this.baseUrl = trimSlashes(typeof config.baseUrl === 'string' ? config.baseUrl : '');
        this.model = nonEmpty(config.model) ?? '';
        this.temperature = typeof config.temperature === 'number' ? config.temperature : undefined;
        this.models = typeof config.models === 'string' ? config.models : '';
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
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
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
            this.host.logger.debug('llm could not list models', { error: error instanceof Error ? error.message : String(error) });
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

        const model = nonEmpty(request.model) ?? this.model;
        if (model.length === 0) throw new PluginError('the model plugin has no model configured and none was asked for').withCode('config');

        if (request.messages.length === 0) throw new PluginError('a generation needs at least one message').withCode('config');

        this.assertCanUseTools(request, model);

        const temperature = request.temperature ?? this.temperature;
        const tools = toToolSet(request.tools);

        const stream = streamText({
            model: provider.chatModel(model),
            messages: toModelMessages(request.messages),
            ...(temperature === undefined ? {} : { temperature }),
            ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
            ...(tools === undefined ? {} : { tools }),
            // Unset unless asked for. The field means nothing to a model that does
            // not reason and a strict server answers 400 rather than ignoring it,
            // so "send nothing" has to be the default rather than a value.
            ...(request.reasoningEffort === undefined ? {} : { providerOptions: { [PROVIDER_NAME]: { reasoningEffort: request.reasoningEffort } } }),
            // The invocation's own signal, so being abandoned by the host and
            // stopping are the same moment rather than two.
            abortSignal: this.host.signal,
        });

        this.host.logger.debug('llm generating', { model, messages: request.messages.length, tools: request.tools?.length ?? 0 });

        return {
            text: stream.textStream,
            // Built here rather than awaited, so `generate` returns as soon as the
            // request is away. Every promise underneath settles when the stream
            // does, which is why the contract is drain-then-read.
            result: this.resultOf(stream),
        };
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
        // server did not list this second is still one the operator annotated.
        const annotated = parseModelList(this.models).find(entry => entry.id === model);
        if (annotated?.tools === true) return;

        throw new PluginError(
            `model "${model}" is not marked as able to use tools; add "${model} +tools" to the plugin's tool-capable models`,
        ).withCode('unsupported');
    }

    /** The SDK's several settled promises, as the one result the station's boundary describes. */
    private async resultOf(stream: ReturnType<typeof streamText>): Promise<LlmResult> {
        const [text, toolCalls, usage, finishReason] = await Promise.all([stream.text, stream.toolCalls, stream.usage, stream.finishReason]);

        return {
            text,
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
            },
            finishReason: toFinishReason(finishReason),
        };
    }

    private authHeaders(): Record<string, string> {
        return this.apiKey === undefined || this.apiKey.length === 0 ? {} : { authorization: `Bearer ${this.apiKey}` };
    }
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

const nonEmpty = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
};

/** Base URLs are concatenated with a path in two places, so the trailing slash goes here once. */
const trimSlashes = (value: string): string => value.trim().replace(/\/+$/, '');
