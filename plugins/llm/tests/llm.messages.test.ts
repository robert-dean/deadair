import { describe, expect, it } from 'vitest';
import { isPluginError, type LlmMessage } from '@deadair/plugin-sdk';

import { toModelMessages, toToolSet } from '../src/llm.messages.js';

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

    it('answers a tool turn against the call id it names', () => {
        const messages: LlmMessage[] = [{ role: 'tool', toolCallId: 'call_1', content: '[{"title":"Roygbiv"}]' }];

        expect(toModelMessages(messages)).toEqual([
            {
                role: 'tool',
                content: [{ type: 'tool-result', toolCallId: 'call_1', toolName: '', output: { type: 'text', value: '[{"title":"Roygbiv"}]' } }],
            },
        ]);
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
