import { describe, expect, it } from 'vitest';
import { isPluginError, type LlmMessage } from '@deadair/plugin-sdk';

import { providerStateOf, splitSystemPrompt, toModelMessages, toToolSet } from '../src/llm.messages.js';

describe('splitSystemPrompt', () => {
    it('lifts a leading system turn out of the conversation', () => {
        const { system, rest } = splitSystemPrompt([
            { role: 'system', content: 'be the station' },
            { role: 'user', content: 'go' },
        ]);

        expect(system).toBe('be the station');
        expect(rest).toEqual([{ role: 'user', content: 'go' }]);
    });

    it('leaves a conversation with no system turn alone', () => {
        const messages: LlmMessage[] = [{ role: 'user', content: 'go' }];

        expect(splitSystemPrompt(messages)).toEqual({ rest: messages });
    });

    it('leaves a system turn that is not first where the caller put it', () => {
        // Reordering it would change what the model sees, and a mid-conversation system turn is
        // unusual enough that the caller meant it.
        const messages: LlmMessage[] = [
            { role: 'user', content: 'go' },
            { role: 'system', content: 'and now this' },
        ];

        expect(splitSystemPrompt(messages)).toEqual({ rest: messages });
    });

    it('copes with an empty conversation', () => {
        expect(splitSystemPrompt([])).toEqual({ rest: [] });
    });
});

describe('toModelMessages', () => {
    it('passes the plain roles through', () => {
        const messages: LlmMessage[] = [
            { role: 'system', content: 'be the station' },
            { role: 'user', content: 'back-announce it' },
            { role: 'assistant', content: 'that was Roygbiv' },
        ];

        expect(toModelMessages(messages)).toEqual([
            { role: 'system', content: 'be the station' },
            { role: 'user', content: 'back-announce it' },
            { role: 'assistant', content: 'that was Roygbiv' },
        ]);
    });

    it('turns an assistant turn that asked for tools into content parts', () => {
        const messages: LlmMessage[] = [
            {
                role: 'assistant',
                content: 'let me check',
                toolCalls: [{ id: 'call_1', name: 'search_catalog', arguments: { query: 'boc' } }],
            },
        ];

        expect(toModelMessages(messages)).toEqual([
            {
                role: 'assistant',
                content: [
                    { type: 'text', text: 'let me check' },
                    { type: 'tool-call', toolCallId: 'call_1', toolName: 'search_catalog', input: { query: 'boc' } },
                ],
            },
        ]);
    });

    it('replays the signed reasoning before the words and the calls', () => {
        // The order is the provider's rather than a preference: Anthropic reads a thinking block
        // arriving after the `tool_use` it belongs to as a turn out of order and refuses it.
        const messages: LlmMessage[] = [
            {
                role: 'assistant',
                content: 'let me check',
                toolCalls: [{ id: 'call_1', name: 'search_catalog', arguments: { query: 'boc' } }],
                providerState: {
                    reasoning: [{ text: 'worth a search', providerMetadata: { anthropic: { signature: 'sig-1' } } }],
                    toolCalls: { call_1: { google: { thoughtSignature: 'sig-2' } } },
                },
            },
        ];

        expect(toModelMessages(messages)).toEqual([
            {
                role: 'assistant',
                content: [
                    { type: 'reasoning', text: 'worth a search', providerOptions: { anthropic: { signature: 'sig-1' } } },
                    { type: 'text', text: 'let me check' },
                    {
                        type: 'tool-call',
                        toolCallId: 'call_1',
                        toolName: 'search_catalog',
                        input: { query: 'boc' },
                        providerOptions: { google: { thoughtSignature: 'sig-2' } },
                    },
                ],
            },
        ]);
    });

    it('leaves a turn alone when its state signed nothing it can use', () => {
        // Lenient rather than throwing, and deliberately: this arrives from a transcript that may
        // have been through JSON, or through a different provider than the one now being spoken to.
        // A malformed entry costs its own signature, not the break.
        const messages: LlmMessage[] = [{ role: 'assistant', content: 'that was Roygbiv', providerState: { reasoning: 'not a list' } }];

        expect(toModelMessages(messages)).toEqual([{ role: 'assistant', content: 'that was Roygbiv' }]);
    });

    it('omits the text part when the model said nothing but the tool call', () => {
        const messages: LlmMessage[] = [{ role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'search_catalog', arguments: {} }] }];

        const [message] = toModelMessages(messages);

        expect(message).toEqual({
            role: 'assistant',
            content: [{ type: 'tool-call', toolCallId: 'call_1', toolName: 'search_catalog', input: {} }],
        });
    });

    it('keeps text and calls in ONE turn rather than splitting them', () => {
        // Two assistant messages would read to the model as having said the same
        // thing twice, which is how a break ends up repeating itself.
        const messages: LlmMessage[] = [{ role: 'assistant', content: 'hold on', toolCalls: [{ id: 'c', name: 't', arguments: {} }] }];

        expect(toModelMessages(messages)).toHaveLength(1);
    });

    it('answers a lone tool turn with an empty name when no call is in view', () => {
        const messages: LlmMessage[] = [{ role: 'tool', toolCallId: 'call_1', content: '[{"title":"Roygbiv"}]' }];

        expect(toModelMessages(messages)).toEqual([
            {
                role: 'tool',
                content: [{ type: 'tool-result', toolCallId: 'call_1', toolName: '', output: { type: 'text', value: '[{"title":"Roygbiv"}]' } }],
            },
        ]);
    });

    it('names a tool result after the call that produced it', () => {
        const messages: LlmMessage[] = [
            { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'search_music', arguments: {} }] },
            { role: 'tool', toolCallId: 'call_1', content: '[{"title":"Roygbiv"}]' },
        ];

        const [, toolMessage] = toModelMessages(messages);

        expect(toolMessage).toEqual({
            role: 'tool',
            content: [
                { type: 'tool-result', toolCallId: 'call_1', toolName: 'search_music', output: { type: 'text', value: '[{"title":"Roygbiv"}]' } },
            ],
        });
    });

    it('refuses a tool turn with no call id, naming it as a caller bug', () => {
        const messages: LlmMessage[] = [{ role: 'tool', content: 'result' }];

        try {
            toModelMessages(messages);
            expect.unreachable('should have thrown');
        } catch (error) {
            expect(isPluginError(error)).toBe(true);
            if (isPluginError(error)) expect(error.code).toBe('config');
        }
    });

    it('round-trips a whole tool exchange in order', () => {
        const messages: LlmMessage[] = [
            { role: 'user', content: 'ask' },
            { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'search', arguments: { q: 'x' } }] },
            { role: 'tool', toolCallId: 'c1', content: 'found' },
            { role: 'assistant', content: 'here it is' },
        ];

        expect(toModelMessages(messages).map(message => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    });
});

describe('providerStateOf', () => {
    it('answers nothing for a provider that signed nothing', () => {
        // Every OpenAI-compatible server, which is why the field never appears on one and the
        // transcript the host builds is what it always was.
        expect(
            providerStateOf([
                { type: 'reasoning', text: 'thinking out loud' },
                { type: 'text', text: 'that was Roygbiv' },
                { type: 'tool-call', toolCallId: 'call_1' },
            ]),
        ).toBeUndefined();
    });

    it('keeps a reasoning block that came with a signature', () => {
        const state = providerStateOf([
            { type: 'reasoning', text: 'they last played it in March', providerMetadata: { anthropic: { signature: 'sig-1' } } },
            { type: 'text', text: 'here it is' },
        ]);

        expect(state).toEqual({ reasoning: [{ text: 'they last played it in March', providerMetadata: { anthropic: { signature: 'sig-1' } } }] });
    });

    it('keeps what a provider attached to a tool call, against its id', () => {
        const state = providerStateOf([{ type: 'tool-call', toolCallId: 'call_1', providerMetadata: { google: { thoughtSignature: 'sig-2' } } }]);

        expect(state).toEqual({ toolCalls: { call_1: { google: { thoughtSignature: 'sig-2' } } } });
    });

    it('drops an unsigned reasoning block sitting beside a signed one', () => {
        // The rule is "carry what the provider SIGNED" rather than "carry the reasoning": an
        // unsigned block is the model thinking out loud, and replaying it puts its own working-out
        // into the transcript as something it said.
        const state = providerStateOf([
            { type: 'reasoning', text: 'out loud', providerMetadata: {} },
            { type: 'reasoning', text: 'signed', providerMetadata: { anthropic: { signature: 'sig-1' } } },
        ]);

        expect(state).toEqual({ reasoning: [{ text: 'signed', providerMetadata: { anthropic: { signature: 'sig-1' } } }] });
    });
});

describe('toToolSet', () => {
    it('answers undefined for no tools, so nothing is sent at all', () => {
        expect(toToolSet(undefined)).toBeUndefined();
        expect(toToolSet([])).toBeUndefined();
    });

    it('keys the set by tool name and keeps the description', () => {
        const tools = toToolSet([{ name: 'search_catalog', description: 'find a track', parameters: { type: 'object' } }]);

        expect(Object.keys(tools ?? {})).toEqual(['search_catalog']);
        expect(tools?.search_catalog?.description).toBe('find a track');
    });

    it('builds every tool WITHOUT an execute, so the SDK returns the call instead of running it', () => {
        // The boundary decision, asserted rather than trusted: an execute here
        // would move the station's tools inside this plugin.
        const tools = toToolSet([
            { name: 'a', description: 'x', parameters: { type: 'object' } },
            { name: 'b', description: 'y', parameters: { type: 'object' } },
        ]);

        for (const declared of Object.values(tools ?? {})) {
            expect(declared.execute).toBeUndefined();
        }
    });
});
