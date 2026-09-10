import { jsonBody, type PluginHost } from '@deadair/plugin-sdk';
import { createAnthropic } from '@ai-sdk/anthropic';
import { APICallError } from 'ai';
import type { LanguageModel, ProviderMetadata } from 'ai';
import { hostFetch } from './llm.fetch.js';
import { ANTHROPIC_BASE_URL, PROBE_TIMEOUT_MS } from './llm.manifest.js';
import type { ProviderArm } from './llm.provider.js';

/** The key this service's provider options are read under, fixed by its SDK adapter. */
const PROVIDER_NAME = 'anthropic';

/** The version this arm's own model probe pins. The SDK sends the same on its calls. */
const API_VERSION = '2023-06-01';

/**
 * How much thinking each of the station's levels buys, in tokens, on a model that still takes a
 * budget rather than a word.
 *
 * Tokens rather than a word, because a budget is the only dial those models have: there is no
 * `reasoning_effort` there. The minimum the service accepts is 1024, so `low` sits above it with
 * room rather than at the edge, and `high` is deliberately short of the enormous budgets the API
 * allows: a break is a paragraph, and a model given tens of thousands of tokens to think about one
 * spends them while a station waits with the model slot held.
 */
const THINKING_BUDGETS = { low: 2_048, medium: 8_192, high: 24_576 } as const;

/**
 * Whether a model id names one that still takes a thinking BUDGET rather than adaptive thinking
 * plus an effort word.
 *
 * True for the `claude-3*` families and for a Claude 4 id whose minor version is absent (the
 * `-YYYYMMDD`-dated ids, e.g. `claude-sonnet-4-20250514`), `0`, `1`, or `5`: Opus 4/4.1/4.5, Sonnet
 * 4/4.5, Haiku 4.5. Everything else, 4.6 and later plus Claude 5 and Fable, thinks adaptively; a
 * model id this rule has never seen defaults to adaptive too, because a new id only ever lands on
 * that side of the line from here on.
 */
export function takesBudget(modelId: string): boolean {
    if (modelId.includes('claude-3')) return true;
    return /claude-(?:opus|sonnet|haiku)-4(?:-(?:0|1|5))?(?:-\d{8})?$/.test(modelId);
}

/**
 * Claude, over its own Messages API.
 *
 * Here rather than as an address on the OpenAI-compatible arm because two things
 * this station does depend on what only this protocol carries. Thinking is a
 * token budget rather than a word, so `low`/`medium`/`high` have to be
 * translated rather than forwarded. And a thinking block comes back SIGNED: the
 * service refuses a tool round trip whose earlier turns arrive without their
 * signatures, which is why `LlmResult.providerState` exists and why a
 * conversation here would otherwise search once and then fail.
 */
export function anthropicArm(host: PluginHost, options: { apiKey: string }): ProviderArm {
    const { apiKey } = options;

    const provider = createAnthropic({
        apiKey,
        baseURL: ANTHROPIC_BASE_URL,
        // Every byte through the host's fetch, so the allowlist, the rate limit, the
        // redirect re-check and the body bounds apply to a model call as they do to
        // anything else. See `llm.fetch.ts`.
        fetch: hostFetch(host),
    });

    return {
        kind: 'anthropic',

        // The vendor serves only its own models and all of them take tools. Asking an
        // operator to tick a box confirming that is asking them to supply something
        // already known, and a box they have not found reads from the console as a
        // station that will not use its own library.
        toolsOnEveryModel: true,

        languageModel: (id: string): LanguageModel => provider.languageModel(id),

        async fetchModels(): Promise<string[]> {
            const response = await host.fetch(`${ANTHROPIC_BASE_URL}/models?limit=100`, {
                headers: { 'x-api-key': apiKey, 'anthropic-version': API_VERSION },
                timeoutMs: PROBE_TIMEOUT_MS,
            });
            if (!response.ok) {
                await response.body?.cancel().catch(() => {});
                // 401 is worth telling apart by hand: it is the one failure an operator
                // can fix from the form they are looking at.
                throw new Error(response.status === 401 ? 'The API key was refused.' : `Server answered HTTP ${response.status}.`);
            }

            const body = await jsonBody<{ data?: { id?: unknown }[] }>(response);
            return (body?.data ?? []).map(entry => (typeof entry.id === 'string' ? entry.id.trim() : '')).filter(id => id.length > 0);
        },

        reasoningOptions(effort: string | undefined, modelId?: string): ProviderMetadata | undefined {
            if (effort === undefined) return undefined;

            // Nothing at all, and this is the one place the arm cannot say what the station
            // means. The API takes `thinking: { type: 'disabled' }`, but this SDK forwards
            // the object only when the type ENABLES thinking — measured in
            // `@ai-sdk/anthropic@2` `index.mjs`, where the whole field is spread behind
            // `isThinking` — so sending it would be a no-op dressed up as a setting, which
            // is worse than the gap. Omitting it is genuinely off on a model whose thinking
            // is opt-in, and is NOT off on one that thinks adaptively by default (Opus 5, for
            // one); an operator who needs it off there has to pick a model that does not.
            if (effort === 'none') return undefined;

            // `modelId` absent means a caller that has not been taught which model is asking:
            // today's budget behaviour, unchanged, rather than a guess.
            if (modelId === undefined || takesBudget(modelId)) {
                const budgetTokens = THINKING_BUDGETS[effort as keyof typeof THINKING_BUDGETS];
                if (budgetTokens === undefined) return undefined;
                return { [PROVIDER_NAME]: { thinking: { type: 'enabled', budgetTokens } } };
            }

            // 4.6 and later take no budget at all (`budget_tokens` is a 400) and think
            // adaptively, with `low`/`medium`/`high` sent as the SDK's own `effort` instead.
            if (effort !== 'low' && effort !== 'medium' && effort !== 'high') return undefined;
            return { [PROVIDER_NAME]: { thinking: { type: 'adaptive' }, effort } };
        },

        /**
         * This service refusing the thinking field itself, rather than any other 400.
         *
         * A model that predates extended thinking answers this way, and so does one
         * asked for a budget it will not take. Both are worth one silent re-attempt
         * without the field; anything else here is a real fault and is reported.
         */
        isReasoningRefusal(error: unknown): boolean {
            return APICallError.isInstance(error) && error.statusCode === 400 && /thinking/.test(error.responseBody ?? '');
        },
    };
}
