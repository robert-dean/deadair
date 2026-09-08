import { jsonBody, type PluginHost } from '@deadair/plugin-sdk';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { APICallError } from 'ai';
import type { LanguageModel, ProviderMetadata } from 'ai';
import { hostFetch } from './llm.fetch.js';
import { PROBE_TIMEOUT_MS } from './llm.manifest.js';
import type { ProviderArm } from './llm.provider.js';

/**
 * The name handed to the AI SDK, which is also the key its provider options are
 * read under. Fixed rather than derived from the plugin id, because changing it
 * would silently stop `reasoningEffort` reaching the server.
 */
const PROVIDER_NAME = 'openai-compatible';

/**
 * Any endpoint speaking the OpenAI chat-completions protocol.
 *
 * The broad arm, and the one an operator reaches for most: a local Ollama or
 * vLLM, OpenAI itself, Groq, Mistral, OpenRouter and most hosted providers all
 * answer here behind whatever address is in `baseUrl`. The other arms exist for
 * the two services whose own protocol carries something this one cannot express,
 * not for coverage.
 *
 * Which is why this is also the arm that cannot answer "do the models take
 * tools": the protocol has no field for it and one endpoint commonly serves both
 * kinds at once, so that stays a question for the operator.
 */
export function openAiCompatibleArm(host: PluginHost, options: { baseUrl: string; apiKey?: string }): ProviderArm {
    const { baseUrl, apiKey } = options;

    const provider = createOpenAICompatible({
        name: PROVIDER_NAME,
        baseURL: baseUrl,
        ...(apiKey === undefined ? {} : { apiKey }),
        // Sends `stream_options: { include_usage: true }`. Without it a streaming
        // response carries no token counts at all — measured against Ollama, which
        // answers with usage only when asked — and `LlmResult.usage` comes back
        // empty, which is the one thing that makes what a break cost observable.
        includeUsage: true,
        // The whole reason this is safe to point at an operator-supplied address.
        // Everything the SDK sends goes through the host's fetch, so the allowlist,
        // the per-upstream rate limit, the redirect re-check and the body bounds all
        // apply to a model call exactly as they do to anything else. A plugin
        // reaching for global fetch here would quietly opt out of all four.
        fetch: hostFetch(host),
    });

    return {
        kind: 'openai-compat',
        toolsOnEveryModel: false,

        languageModel: (id: string): LanguageModel => provider.chatModel(id),

        async fetchModels(): Promise<string[]> {
            const headers: Record<string, string> = apiKey === undefined || apiKey.length === 0 ? {} : { authorization: `Bearer ${apiKey}` };
            const response = await host.fetch(`${baseUrl}/models`, { headers, timeoutMs: PROBE_TIMEOUT_MS });
            if (!response.ok) {
                await response.body?.cancel().catch(() => {});
                throw new Error(`Server answered HTTP ${response.status}.`);
            }

            const body = await jsonBody<{ data?: { id?: unknown }[] }>(response);
            return (body?.data ?? []).map(entry => (typeof entry.id === 'string' ? entry.id.trim() : '')).filter(id => id.length > 0);
        },

        reasoningOptions(effort: string | undefined): ProviderMetadata | undefined {
            if (effort === undefined) return undefined;

            // Verbatim, including `none`: that is the value a reasoning model reads as
            // "answer without reasoning", and it is this protocol's own vocabulary
            // rather than a translation of the station's.
            return { [PROVIDER_NAME]: { reasoningEffort: effort } };
        },

        /**
         * A strict server saying it does not know `reasoning_effort`.
         *
         * `maxRetries: 0` on the call is why this arrives as `APICallError` rather than
         * the SDK's own `RetryError` wrapping it: unwrapped, the status code and the
         * response body it quotes are still on it.
         */
        isReasoningRefusal(error: unknown): boolean {
            return APICallError.isInstance(error) && error.statusCode === 400 && /reasoning_effort/.test(error.responseBody ?? '');
        },
    };
}
