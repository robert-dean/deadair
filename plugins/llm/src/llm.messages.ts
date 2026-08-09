import { PluginError, type LlmMessage, type LlmToolDeclaration } from '@deadair/plugin-sdk';
import { jsonSchema, tool, type ModelMessage, type ToolSet } from 'ai';

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
                if (message.toolCalls === undefined || message.toolCalls.length === 0) {
                    return { role: 'assistant', content: message.content };
                }

                // Content parts rather than a bare string: the text and the calls are
                // one turn, and splitting them into two assistant messages is how a
                // model ends up seeing itself say the same thing twice.
                return {
                    role: 'assistant',
                    content: [
                        ...(message.content.length > 0 ? [{ type: 'text' as const, text: message.content }] : []),
                        ...message.toolCalls.map(call => ({
                            type: 'tool-call' as const,
                            toolCallId: call.id,
                            toolName: call.name,
                            input: call.arguments,
                        })),
                    ],
                };
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
