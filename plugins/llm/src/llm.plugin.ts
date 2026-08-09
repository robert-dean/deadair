import {
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
import { describeModels } from './llm.models.js';
import { llmManifest, PROBE_TIMEOUT_MS, PROVIDER_NAME } from './llm.manifest.js';

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

        this.host.logger.info('llm ready', { baseUrl: this.baseUrl, model: this.model, models: describeModels(this.models, this.model).length });
    }

    async testConnection(): Promise<{ ok: boolean; message: string }> {
        if (this.baseUrl.length === 0) return { ok: false, message: 'No server URL set.' };
        if (this.model.length === 0) return { ok: false, message: 'No default model set.' };

        // `/models` rather than a generation: it is the one call every
        // OpenAI-compatible server answers cheaply, and this is a reachability
        // check rather than a test of whether the model is any good.
        const response = await this.host.fetch(`${this.baseUrl}/models`, { headers: this.authHeaders(), timeoutMs: PROBE_TIMEOUT_MS });
        if (!response.ok) {
            await response.body?.cancel().catch(() => {});
            return { ok: false, message: `Server answered HTTP ${response.status}.` };
        }

        await response.body?.cancel().catch(() => {});
        return { ok: true, message: `Connected. Default model "${this.model}".` };
    }

    /**
     * What the operator said this server has.
     *
     * Not a passthrough of the server's own `/models`, and deliberately: that
     * list cannot say which models accept tools, which is the question the host
     * asks this for. See `llm.models.ts`.
     */
    async listModels(): Promise<LlmModelInfo[]> {
        return describeModels(this.models, this.model);
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

        const declared = describeModels(this.models, this.model).find(entry => entry.id === model);
        if (declared?.tools === true) return;

        throw new PluginError(`model "${model}" is not declared as able to use tools; add "+tools" beside it in the plugin's model list`).withCode(
            'unsupported',
        );
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
