import { PluginError, type LlmMessage, type LlmToolDeclaration } from '@deadair/plugin-sdk';
import { jsonSchema, tool, type AssistantContent, type ModelMessage, type ProviderMetadata, type ToolSet } from 'ai';

/**
 * Translating between the station's conversation and the AI SDK's.
 *
 * Both describe the same thing and neither is a subset of the other, so this is
 * the one file that has to know both. Keeping it out of the plugin class means
 * the mapping is testable without a model, a server or a host.
 */

/**
 * The station's messages, as the SDK's.
 *
 * The interesting case is the pair a tool round trip produces. An `assistant`
 * turn that asked for a tool becomes a message whose content is its tool-call
 * parts, and the `tool` turn answering it becomes a `tool` message naming the
 * same id. Losing either one leaves the model reading an answer to a question it
 * cannot see, which it handles by inventing what the question was.
 *
 * @throws {PluginError} `config` for a `tool` turn with no `toolCallId`. That is
 * a caller's bug rather than a model's, and failing here names it while the
 * stack still points at whoever built the conversation.
 */

/**
 * The leading system turn lifted out of the conversation, if there is one.
 *
 * The AI SDK asks for a system prompt as its own option rather than as the first
 * message, and warns when it finds one inline: a system turn sitting in the
 * message list is easier for later content to imitate. The station's boundary
 * keeps `system` as a role because that is what a conversation IS, so the
 * separation happens here, at the one place that already translates between the
 * two vocabularies.
 */
export function splitSystemPrompt(messages: readonly LlmMessage[]): { system?: string; rest: readonly LlmMessage[] } {
    const [first, ...rest] = messages;
    if (first?.role !== 'system') return { rest: messages };

    // Only a LEADING system turn. One in the middle of a conversation is unusual enough that
    // reordering it would change what the model sees, so it stays where the caller put it.
    return { system: first.content, rest };
}

export function toModelMessages(messages: readonly LlmMessage[]): ModelMessage[] {
    return messages.map(message => {
        switch (message.role) {
            case 'system':
                return { role: 'system', content: message.content };

            case 'user':
                return { role: 'user', content: message.content };

            case 'assistant': {
                const signed = readProviderState(message.providerState);

                if ((message.toolCalls === undefined || message.toolCalls.length === 0) && signed.reasoning.length === 0) {
                    return { role: 'assistant', content: message.content };
                }

                // Content parts rather than a bare string: the text and the calls are
                // one turn, and splitting them into two assistant messages is how a
                // model ends up seeing itself say the same thing twice.
                //
                // Reasoning first, then the words, then the calls, and the order is the
                // provider's rather than a preference: Anthropic reads a thinking block
                // that arrives after the `tool_use` it belongs to as a turn out of order
                // and refuses it.
                const content: AssistantContent = [
                    ...signed.reasoning.map(part => ({
                        type: 'reasoning' as const,
                        text: part.text,
                        providerOptions: part.providerMetadata,
                    })),
                    ...(message.content.length > 0 ? [{ type: 'text' as const, text: message.content }] : []),
                    ...(message.toolCalls ?? []).map(call => ({
                        type: 'tool-call' as const,
                        toolCallId: call.id,
                        toolName: call.name,
                        input: call.arguments,
                        // Only where this provider signed THIS call. An entry the model never
                        // made cannot be invented here, and a call with nothing signed goes
                        // out exactly as it did before any of this existed.
                        ...(signed.toolCalls[call.id] === undefined ? {} : { providerOptions: signed.toolCalls[call.id] }),
                    })),
                ];

                return { role: 'assistant', content };
            }

            case 'tool': {
                if (message.toolCallId === undefined || message.toolCallId.length === 0) {
                    throw new PluginError('a tool message must name the call it answers').withCode('config');
                }

                return {
                    role: 'tool',
                    content: [
                        {
                            type: 'tool-result' as const,
                            toolCallId: message.toolCallId,
                            // Not carried on the station's message, and not needed: the id is
                            // what the model matches on, and a name that disagreed with the id
                            // would be a second source of truth for the same link.
                            toolName: '',
                            output: { type: 'text' as const, value: message.content },
                        },
                    ],
                };
            }
        }
    });
}

/**
 * The station's tool declarations, as the SDK's tool set.
 *
 * **Every one of them is execute-less on purpose.** A tool with an `execute` is
 * run by the SDK inside this plugin; without one, the call comes back as data
 * and the host runs it. That is the whole boundary decision, and it is enforced
 * here by omission, so it is worth saying out loud: adding `execute` to this
 * object would quietly move the station's tools inside a plugin.
 *
 * The parameters arrive as JSON Schema and stay as JSON Schema. `jsonSchema()`
 * wraps them without validating, which is right: the declaration came from the
 * host, and re-checking it here would only turn the host's bug into this
 * plugin's error.
 */
export function toToolSet(declarations: readonly LlmToolDeclaration[] | undefined): ToolSet | undefined {
    if (declarations === undefined || declarations.length === 0) return undefined;

    const tools: ToolSet = {};
    for (const declaration of declarations) {
        tools[declaration.name] = tool({
            description: declaration.description,
            inputSchema: jsonSchema(declaration.parameters),
        });
    }
    return tools;
}

/**
 * What a provider signed on one turn, in the shape it is carried between them.
 *
 * Deliberately not a description of anything: the fields hold whatever the
 * provider put in `providerMetadata`, and nothing here or in the host looks
 * inside. Two providers need it and neither needs the other's, so a shape that
 * understood either one would be a shape that has to grow for the third.
 */
export interface ProviderState {
    /**
     * The reasoning blocks, in the order the model produced them, each with the
     * metadata that came with it. Anthropic's `signature` lives here, and a turn
     * replayed without it is refused.
     */
    reasoning: { text: string; providerMetadata: ProviderMetadata }[];

    /** Per tool-call id, what the provider attached to that call. Gemini's `thoughtSignature` lives here. */
    toolCalls: Record<string, ProviderMetadata>;
}

/** One part of a finished generation, as much of it as this file reads. */
interface GeneratedPart {
    type: string;
    text?: string;
    toolCallId?: string;
    providerMetadata?: ProviderMetadata;
}

/**
 * What this turn produced that has to go back, out of everything it produced.
 *
 * **Only what carries metadata.** A reasoning block with nothing attached is the
 * model thinking out loud on a server that signs nothing, and sending it back
 * would put the model's own working-out into the transcript as an assistant turn
 * — which is exactly what `spokenAnswer` refuses to do for the same reason. So
 * the rule is "carry what the provider SIGNED", and it is what keeps every
 * OpenAI-compatible server behaving as it did before this existed: Ollama
 * attaches nothing, so nothing is captured and nothing new is sent.
 *
 * Answers `undefined` rather than an empty state when there is nothing, so a
 * result and a transcript from a provider that signs nothing carry no new field
 * at all.
 */
export function providerStateOf(parts: readonly GeneratedPart[]): Record<string, unknown> | undefined {
    const reasoning: ProviderState['reasoning'] = [];
    const toolCalls: ProviderState['toolCalls'] = {};

    for (const part of parts) {
        const metadata = part.providerMetadata;
        if (metadata === undefined || Object.keys(metadata).length === 0) continue;

        if (part.type === 'reasoning') {
            reasoning.push({ text: part.text ?? '', providerMetadata: metadata });
            continue;
        }

        if (part.type === 'tool-call' && part.toolCallId !== undefined) {
            toolCalls[part.toolCallId] = metadata;
        }
    }

    if (reasoning.length === 0 && Object.keys(toolCalls).length === 0) return undefined;

    return {
        ...(reasoning.length === 0 ? {} : { reasoning }),
        ...(Object.keys(toolCalls).length === 0 ? {} : { toolCalls }),
    };
}

/**
 * The state as this file will use it, out of the opaque record the host handed back.
 *
 * Lenient throughout, and that is the right direction here: this arrives from a
 * transcript that has been through the host, may have been written and read back
 * as JSON, and may have been produced by a different provider than the one now
 * being spoken to. A malformed entry costs its own signature — the same
 * generation the field exists to improve — where throwing would cost the break.
 */
function readProviderState(state: Record<string, unknown> | undefined): ProviderState {
    const empty: ProviderState = { reasoning: [], toolCalls: {} };
    if (state === undefined) return empty;

    const reasoning = Array.isArray(state.reasoning)
        ? state.reasoning
              .filter(isRecord)
              .filter(entry => isRecord(entry.providerMetadata))
              .map(entry => ({
                  text: typeof entry.text === 'string' ? entry.text : '',
                  // The one cast in this file, and it is the honest description of what
                  // happened: this value WAS a `ProviderMetadata` when the provider
                  // attached it, and the round trip through the host's opaque record and
                  // possibly through JSON is what lost the type rather than the shape.
                  // Anything malformed enough for the cast to be a lie is a signature the
                  // provider will reject, which costs this generation and nothing else.
                  providerMetadata: entry.providerMetadata as ProviderMetadata,
              }))
        : [];

    const toolCalls: ProviderState['toolCalls'] = {};
    if (isRecord(state.toolCalls)) {
        for (const [id, metadata] of Object.entries(state.toolCalls)) {
            if (isRecord(metadata)) toolCalls[id] = metadata as ProviderMetadata;
        }
    }

    return { reasoning, toolCalls };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
