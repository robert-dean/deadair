/**
 * The `llm` capability. A language-model plugin takes a conversation and answers
 * with words: the line a DJ says, the running order a set generator asked for,
 * the copy for a sponsor read.
 *
 * ## This is a transport, not a writer
 *
 * Nothing here knows what a break is. That is deliberate and it is the one
 * constraint worth defending: the previous station had five things that produced
 * a script (a talk break, a sign-on, a news bulletin, a DJ set, a two-voice
 * dialogue) and every one of them was messages in and text out. A capability
 * shaped around any single one of them has to be reshaped for the next.
 *
 * So: {@link LlmMessage}s in, text out, and everything about WHAT to say lives
 * on the station's side of the fence.
 *
 * ## The words come back as a stream
 *
 * {@link LlmPluginInstance.generate} answers with a handle carrying a stream, the
 * way `speak()` does, and for a stronger reason than memory. The host serializes
 * generations through a single slot, and it holds that slot until the words stop
 * arriving rather than until the call resolves. On a local model, releasing early
 * lets two generations overlap and both of them get slower.
 *
 * Read {@link LlmHandle.text} to the end, or `cancel()` it. Then await
 * {@link LlmHandle.result}, which is where the tool calls, the usage and the
 * reason it stopped are. {@link collectGeneration} does both for a caller that
 * only wants the answer.
 *
 * ## The model is chosen per call
 *
 * {@link LlmRequest.model} overrides whatever the plugin has configured, because
 * a station wants a big model for a show and a small one for a station ident, and
 * one plugin holds exactly one config row (`plugin_configs.plugin_id` is a
 * primary key). Absent means "whatever you are set up with", which is the
 * ordinary case.
 *
 * ## Tools are declared here and executed by the host
 *
 * A request may carry {@link LlmToolDeclaration}s. What comes back is
 * {@link LlmToolCall}s: data, not invocations. The host runs the tool and sends
 * the result back as another message.
 *
 * That split is not ceremony. A callback crossing this boundary would be a
 * function in a payload, and it would put station code inside a plugin, which is
 * the wrong side of the fence for deciding what the station is allowed to do.
 * Every shape in this file except {@link LlmHandle} is JSON-safe, and the one
 * exception carries a stream on purpose.
 */

import type { PluginLifecycle } from '../plugin.lifecycle.js';

/**
 * How hard a reasoning model should think before answering.
 *
 * Sent as `reasoning_effort`, and **only when the caller asked for it**. Leave it
 * unset for anything that is not a reasoning model: the field means nothing to a
 * plain model and a strict OpenAI-compatible server answers 400 rather than
 * ignoring it.
 */
export type LlmReasoningEffort = 'low' | 'medium' | 'high';

/** Why a generation stopped. `tool-calls` is the one the host's loop acts on. */
export type LlmFinishReason = 'stop' | 'length' | 'tool-calls' | 'content-filter' | 'error' | 'other';

/** One turn of the conversation. */
export interface LlmMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';

    /**
     * The words. Empty is legitimate on an `assistant` turn that did nothing but
     * ask for a tool.
     */
    content: string;

    /**
     * What this `assistant` turn asked for, when it asked for tools.
     *
     * The host replays it verbatim on the next call, because a model that cannot
     * see its own tool call has no idea what the `tool` message after it is
     * answering.
     */
    toolCalls?: LlmToolCall[];

    /** Which call this `tool` turn answers. Absent on every other role. */
    toolCallId?: string;
}

/** A tool the model may ask for. */
export interface LlmToolDeclaration {
    /** How the model names it when calling. */
    name: string;

    /**
     * What it does, written for the model rather than for a developer. This is
     * the entire basis on which it decides whether to call the thing, so "current
     * conditions and today's high and low for a place" beats "weather lookup".
     */
    description: string;

    /**
     * JSON Schema for the arguments, as a plain object.
     *
     * Not a zod schema: this is a payload that is sent, and a schema instance is
     * a class. Convert on the way in if that is what you hold.
     */
    parameters: Record<string, unknown>;
}

/** The model asking for a tool. Data, not an invocation. */
export interface LlmToolCall {
    /** The model's own id for this call, quoted back on {@link LlmMessage.toolCallId}. */
    id: string;

    /** Which declaration it wants, by {@link LlmToolDeclaration.name}. */
    name: string;

    /**
     * The arguments, already parsed out of the JSON the model produced.
     *
     * Unvalidated against the declared schema: the model is perfectly capable of
     * inventing a field or omitting a required one, and the host checks before
     * running anything.
     */
    arguments: Record<string, unknown>;
}

/** What one generation cost. Absent fields are ones the provider did not report. */
export interface LlmUsage {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
}

/** One conversation to continue. */
export interface LlmRequest {
    /**
     * The conversation so far, oldest first, with the system prompt as the first
     * turn where there is one.
     */
    messages: LlmMessage[];

    /** Which model, or absent for the plugin's configured one. */
    model?: string;

    /** Sampling temperature, or absent for the plugin's configured one. */
    temperature?: number;

    /** A ceiling on the answer, in tokens. Absent means the provider's own. */
    maxOutputTokens?: number;

    /** See {@link LlmReasoningEffort}. Absent means send nothing at all. */
    reasoningEffort?: LlmReasoningEffort;

    /**
     * What the model may call.
     *
     * Only sent to a model that says it can (see {@link LlmModelInfo.tools}), so
     * a plugin receiving this has already been told the model supports it. If it
     * does not, answer `unsupported` rather than dropping them silently: a break
     * written without the facts a tool would have supplied is worse than one that
     * fell back to the deterministic writer.
     */
    tools?: LlmToolDeclaration[];
}

/** Everything about a finished generation except the words as they arrived. */
export interface LlmResult {
    /** The whole answer, accumulated. Empty when the model only asked for tools. */
    text: string;

    /** What it asked for. Empty on an ordinary answer. */
    toolCalls: LlmToolCall[];

    /** What it cost, where the provider said. */
    usage?: LlmUsage;

    finishReason: LlmFinishReason;
}

/**
 * A generation in flight.
 *
 * Carries a live stream, which is why it is classified as a live-object type in
 * `boundary.json.safe.ts` rather than as a payload. {@link LlmResult} is the
 * payload, and it is JSON-safe.
 */
export interface LlmHandle {
    /**
     * The answer as it arrives.
     *
     * The host reads it to the end or cancels it, and either one releases what is
     * underneath. Usually the provider's own stream forwarded through, which
     * makes that true for free.
     */
    text: ReadableStream<string>;

    /**
     * Settles once the generation is done.
     *
     * **Read {@link text} first.** A provider stream that nobody is draining
     * applies backpressure, so awaiting this without consuming the words is how a
     * caller waits forever. {@link collectGeneration} exists so that ordering is
     * not something each caller has to remember.
     */
    result: Promise<LlmResult>;
}

/** One model this plugin can be asked for. */
export interface LlmModelInfo {
    /** The id to pass back as {@link LlmRequest.model}. */
    id: string;

    /** What the console calls it. Absent means show the id. */
    label?: string;

    /**
     * Whether this model can be given {@link LlmRequest.tools}.
     *
     * Per MODEL, not per server, which is why it lives here rather than on the
     * plugin: one endpoint commonly serves both a model that can call tools and
     * one that cannot, and asking the wrong one is a failed generation rather
     * than a degraded answer.
     */
    tools: boolean;
}

/** A plugin that can produce words. */
export interface LlmPluginInstance extends PluginLifecycle {
    /**
     * Continue the conversation.
     *
     * May return before any words exist, because the handle carries a stream and
     * not the text, so a model that thinks for ten seconds shows up as a slow
     * first chunk rather than as a slow `generate`.
     *
     * @throws {PluginError} `config` when the plugin is not set up enough to try
     *   (no server address, no model), `unsupported` when asked for tools the
     *   named model cannot do, `upstream` when the provider refused, `timeout`
     *   when it did not answer, `rate_limited` when it said to wait.
     */
    generate(request: LlmRequest): Promise<LlmHandle>;

    /**
     * The models this plugin can be asked for, for a console drawing a list and
     * for the host deciding whether it may send tools.
     *
     * Optional, like `listVoices` on the speech capability. But note what absent
     * costs: the host has no way to learn that any model here supports tools, so
     * it sends none. A plugin that wants tool calling has to describe itself.
     */
    listModels?(): Promise<LlmModelInfo[]>;
}

/**
 * Drain a handle and answer with the finished result.
 *
 * The ordinary way to use {@link LlmPluginInstance.generate} when the caller
 * wants the answer rather than the words as they arrive. Streaming still happens
 * underneath, so the host's slot is still released at the right moment; what this
 * removes is the chance of awaiting {@link LlmHandle.result} without draining
 * {@link LlmHandle.text} first.
 *
 * A free function rather than a method, following `jsonBody` and `tryJsonBody`:
 * it keeps the handle the platform's own shape, and it is nothing a plugin should
 * have to implement.
 */
export async function collectGeneration(handle: LlmHandle): Promise<LlmResult> {
    const reader = handle.text.getReader();
    try {
        // Read for the backpressure, not for the text: `result.text` is the accumulated
        // answer and the authority on it. A plugin forwarding a provider stream and a
        // plugin buffering one both satisfy that, and only the first would agree with
        // whatever this loop concatenated.
        while (!(await reader.read()).done) {
            // Nothing to do with the chunk here.
        }
    } finally {
        reader.releaseLock();
    }

    return handle.result;
}
