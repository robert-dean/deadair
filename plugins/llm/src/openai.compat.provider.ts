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
 * The `headers` cell of a provider row, one `Name: value` per line.
 *
 * A pure parse rather than something that reaches for the row itself, so it is testable on its own
 * and so a hand-typed value that comes out empty (no colon, a blank line, a name with nothing before
 * the colon) degrades to "no extra headers" rather than a load failure: the same tolerance
 * `parseMultiSelect` and the rest of this plugin's config readers give a value an operator mistyped.
 * Split at the FIRST colon only, so a header value that is itself a `Name: value` pair (a signed
 * cookie, a scheme with a colon in it) keeps everything after the header's own name. A later line
 * naming the same header, compared case-insensitively because HTTP header names are, replaces the
 * earlier one rather than adding a second: there is one slot for a given header on the wire, so
 * keeping both would just be silently picking whichever `fetch` happens to send last.
 */
export function parseHeaderLines(text: string | undefined): Record<string, string> {
    if (text === undefined) return {};

    const byLowerName = new Map<string, { name: string; value: string }>();
    for (const line of text.split('\n')) {
        const colon = line.indexOf(':');
        if (colon === -1) continue;

        const name = line.slice(0, colon).trim();
        if (name.length === 0) continue;

        byLowerName.set(name.toLowerCase(), { name, value: line.slice(colon + 1).trim() });
    }

    return Object.fromEntries([...byLowerName.values()].map(({ name, value }) => [name, value]));
}

/** Whether `headers` already names `header`, compared the way HTTP does: case-insensitively. */
function hasHeaderNamed(headers: Record<string, string>, header: string): boolean {
    return Object.keys(headers).some(name => name.toLowerCase() === header);
}

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
export function openAiCompatibleArm(host: PluginHost, options: { baseUrl: string; apiKey?: string; headers?: Record<string, string> }): ProviderArm {
    const { baseUrl, apiKey, headers: rowHeaders } = options;

    const provider = createOpenAICompatible({
        name: PROVIDER_NAME,
        baseURL: baseUrl,
        ...(apiKey === undefined ? {} : { apiKey }),
        ...(rowHeaders === undefined ? {} : { headers: rowHeaders }),
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
            // The row's own headers first, then the key-derived `authorization`, but only where the
            // row did not set one itself. A gateway that wants its OWN bearer scheme in that header
            // gets to have it; a row with no opinion falls back to the key exactly as it always has.
            const headers: Record<string, string> = { ...rowHeaders };
            if (apiKey !== undefined && apiKey.length > 0 && !hasHeaderNamed(headers, 'authorization')) headers.authorization = `Bearer ${apiKey}`;
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
