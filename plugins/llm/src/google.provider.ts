import { jsonBody, type PluginHost } from '@deadair/plugin-sdk';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { APICallError } from 'ai';
import type { LanguageModel, ProviderMetadata } from 'ai';
import { hostFetch } from './llm.fetch.js';
import { GOOGLE_BASE_URL, PROBE_TIMEOUT_MS } from './llm.manifest.js';
import type { ProviderArm } from './llm.provider.js';

/** The key this service's provider options are read under, fixed by its SDK adapter. */
const PROVIDER_NAME = 'google';

/**
 * The station's levels as this service's own.
 *
 * A word rather than a token budget here, and the words nearly line up: this API
 * takes `minimal | low | medium | high`, so only `none` has nowhere to go. It is
 * spelled out rather than passed through so that a level added to the station's
 * vocabulary is a compile error here instead of a field this service ignores.
 */
const THINKING_LEVELS = { low: 'low', medium: 'medium', high: 'high' } as const;

/**
 * How many pages of models to walk before giving up on the list.
 *
 * There is a page token and therefore a loop, and a loop against somebody else's
 * pagination on the path of `listModels` is a loop that wants a bound. Three
 * pages at a thousand entries is far more than this API has ever returned, so
 * reaching the limit means the token stopped advancing rather than that a
 * station has that many models.
 */
const MAX_MODEL_PAGES = 3;

/**
 * Gemini, over the Generative Language API.
 *
 * Here rather than as an address on the OpenAI-compatible arm — Google does
 * publish one of those — because of what the compatible endpoint drops. Gemini 3
 * signs its function calls, and a tool round trip that replays them without the
 * signature is a turn the service does not trust; `LlmResult.providerState` is
 * what carries them, and the compatible endpoint has nowhere to put them. The
 * thinking level is the same story in miniature.
 */
export function googleArm(host: PluginHost, options: { apiKey: string }): ProviderArm {
    const { apiKey } = options;

    const provider = createGoogleGenerativeAI({
        apiKey,
        baseURL: GOOGLE_BASE_URL,
        // Every byte through the host's fetch. See `llm.fetch.ts`.
        fetch: hostFetch(host),
    });

    return {
        kind: 'google',

        // One vendor's own models, all of which take tools. See the same note on the
        // Anthropic arm: asking an operator to tick a box confirming it is asking them
        // for something already known.
        toolsOnEveryModel: true,

        languageModel: (id: string): LanguageModel => provider.languageModel(id),

        async fetchModels(): Promise<string[]> {
            const ids: string[] = [];
            let pageToken: string | undefined;

            for (let page = 0; page < MAX_MODEL_PAGES; page++) {
                const query = pageToken === undefined ? '' : `&pageToken=${encodeURIComponent(pageToken)}`;
                const response = await host.fetch(`${GOOGLE_BASE_URL}/models?pageSize=1000${query}`, {
                    headers: { 'x-goog-api-key': apiKey },
                    timeoutMs: PROBE_TIMEOUT_MS,
                });
                if (!response.ok) {
                    await response.body?.cancel().catch(() => {});
                    // 400 is what this service answers to a key it will not take, and it is
                    // the one failure an operator can fix from the form they are looking at.
                    throw new Error(
                        response.status === 400 || response.status === 403 ? 'The API key was refused.' : `Server answered HTTP ${response.status}.`,
                    );
                }

                const body = await jsonBody<{ models?: { name?: unknown; supportedGenerationMethods?: unknown }[]; nextPageToken?: unknown }>(
                    response,
                );

                for (const entry of body?.models ?? []) {
                    // Only the ones that can hold a conversation. The same list carries
                    // embedding and image models, and offering those as something to write a
                    // break with is offering a choice that fails on first use.
                    const methods = Array.isArray(entry.supportedGenerationMethods) ? entry.supportedGenerationMethods : [];
                    if (!methods.includes('generateContent')) continue;

                    // `models/gemini-x` as `gemini-x`: the prefix is this API's own path
                    // rather than part of the name, and the SDK puts it back on the way out.
                    const name = typeof entry.name === 'string' ? entry.name.trim().replace(/^models\//, '') : '';
                    if (name.length > 0 && !ids.includes(name)) ids.push(name);
                }

                const next = typeof body?.nextPageToken === 'string' ? body.nextPageToken : '';
                if (next.length === 0 || next === pageToken) break;
                pageToken = next;
            }

            return ids;
        },

        reasoningOptions(effort: string | undefined): ProviderMetadata | undefined {
            if (effort === undefined) return undefined;

            // A budget of zero rather than a word, because the level vocabulary has no
            // "off" in it. Zero is what this API reads as "do not think", and it is a
            // value the SDK carries rather than one it drops.
            if (effort === 'none') return { [PROVIDER_NAME]: { thinkingConfig: { thinkingBudget: 0 } } };

            const thinkingLevel = THINKING_LEVELS[effort as keyof typeof THINKING_LEVELS];
            if (thinkingLevel === undefined) return undefined;

            return { [PROVIDER_NAME]: { thinkingConfig: { thinkingLevel } } };
        },

        /**
         * This service refusing the thinking field itself.
         *
         * The case that makes it worth having: a 2.5-era model handed `thinkingLevel`,
         * which is a 3-era field. One silent re-attempt without it is a break written
         * rather than a break lost.
         */
        isReasoningRefusal(error: unknown): boolean {
            return APICallError.isInstance(error) && error.statusCode === 400 && /thinking/i.test(error.responseBody ?? '');
        },
    };
}
