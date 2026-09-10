import type { LanguageModel, ProviderMetadata } from 'ai';

/**
 * One way of speaking to a model service, behind the manifest's `providerKind`.
 *
 * ## Why this is an arm rather than a second plugin
 *
 * The AI SDK is already the provider abstraction, and everything above this file
 * — the single model slot, the tool loop, the effort fallback, the stream whose
 * cancellation stops the generation, the answer recovered out of a reasoning
 * channel — is the same work whichever service is answering. A second plugin
 * would be a second copy of all of it kept in step by hand, and would make
 * "which provider" a thing an operator changes by installing something rather
 * than by choosing from a list.
 *
 * So an arm is deliberately small: build a model, list what exists, say what
 * this service calls thinking, and recognise this service refusing it. Anything
 * an arm knows that the plugin also knows is a rule that has to hold twice.
 *
 * ## The one thing an arm may NOT do
 *
 * Reach the network by any route other than the host's fetch. Every arm hands
 * `hostFetch(host)` to its SDK provider and uses `host.fetch` for its own model
 * probe, which is what keeps the allowlist, the per-upstream rate limit, the
 * redirect re-check and the body bounds applying to a model call. See
 * `llm.fetch.ts`.
 */
export interface ProviderArm {
    /** Which `providerKind` built this. Reported in logs, so a station's own words name their source. */
    readonly kind: string;

    /**
     * The SDK model for a name, ready for `streamText`.
     *
     * Never validates the name against what {@link fetchModels} said: a proxy
     * that serves a model without listing it is a real thing, and the service's
     * own 404 is a better error than a guess made here.
     */
    languageModel(id: string): LanguageModel;

    /**
     * The model ids this service has.
     *
     * @throws {Error} with a sentence a console can show, for a service that
     * refused or could not be reached. The plugin decides what to do about it,
     * and does something different per caller: `testConnection` reports it,
     * `listModels` carries on without it.
     */
    fetchModels(): Promise<string[]>;

    /**
     * What one call carries to ask for this much thinking, in the SDK's
     * per-provider options, or nothing at all.
     *
     * `effort` is what the plugin decided to send after the setting and the
     * caller's hint: `'none'`, `'low'`, `'medium'`, `'high'`, or `undefined`
     * for "say nothing about it", which every arm must answer `undefined` to.
     * The vocabulary is the station's rather than any service's, because it is
     * the one an operator picked from a list; translating it is the arm's job.
     *
     * `modelId` is the resolved id the call is actually addressed to, optional
     * because most arms have one way of asking regardless of which model
     * answers. An arm whose service asks differently by model (Anthropic's
     * budget-vs-adaptive split is the one that exists today) reads it; an arm
     * that ignores the parameter keeps compiling unchanged.
     */
    reasoningOptions(effort: string | undefined, modelId?: string): ProviderMetadata | undefined;

    /**
     * Whether a fault is this service refusing the thinking field itself, rather
     * than any other way a generation fails.
     *
     * The bar is high on purpose. A true answer costs one silent re-attempt
     * without the field and latches for the rest of the plugin's life, so
     * anything broader than "this exact field was not understood" would quietly
     * turn thinking off across a station because one model was busy.
     */
    isReasoningRefusal(error: unknown): boolean;

    /**
     * Whether every model this service lists accepts tools.
     *
     * True for a service with one vendor's own models behind it, where tool
     * support is a property of the product and asking an operator to tick a box
     * is asking them to confirm something already known. False for an
     * OpenAI-compatible endpoint, which commonly serves both kinds at once and
     * reports nothing either way — the one thing in this plugin an operator has
     * to know. See `llm.models.ts`.
     */
    readonly toolsOnEveryModel: boolean;
}
