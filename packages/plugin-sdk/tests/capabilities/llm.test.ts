import { describe, expect, it } from 'vitest';

import { collectGeneration, type LlmHandle, type LlmResult } from '../../src/capabilities/llm.js';

const RESULT: LlmResult = {
    text: 'That was Roygbiv, by Boards of Canada.',
    toolCalls: [],
    usage: { inputTokens: 12, outputTokens: 9, totalTokens: 21 },
    finishReason: 'stop',
};

/**
 * A handle whose `result` only settles once its stream has been drained, which is
 * how a real provider stream behaves: the promises behind it are fed by the same
 * reads that produce the text.
 *
 * Written this way on purpose. A handle that resolved `result` eagerly would pass
 * these tests without `collectGeneration` doing anything at all.
 */
function handleFor(chunks: string[], result: LlmResult = RESULT): { handle: LlmHandle; pulled: () => number } {
    let pulled = 0;
    let settle: (value: LlmResult) => void = () => {};
    const settled = new Promise<LlmResult>(resolve => {
        settle = resolve;
    });

    const text = new ReadableStream<string>({
        pull(controller) {
            if (pulled >= chunks.length) {
                controller.close();
                settle(result);
                return;
            }
            controller.enqueue(chunks[pulled]!);
            pulled += 1;
        },
    });

    return { handle: { text, result: settled }, pulled: () => pulled };
}

describe('collectGeneration', () => {
    it('drains the stream and answers with the result', async () => {
        const { handle, pulled } = handleFor(['That was ', 'Roygbiv, ', 'by Boards of Canada.']);

        await expect(collectGeneration(handle)).resolves.toEqual(RESULT);
        expect(pulled()).toBe(3);
    });

    it('answers with the accumulated text from the result, not its own concatenation', async () => {
        // The two deliberately disagree. A plugin that buffers rather than forwards
        // is entitled to a `result.text` the chunks do not add up to, and the result
        // is the authority: this is what stops a caller quietly getting a different
        // answer depending on which kind of plugin is installed.
        const { handle } = handleFor(['ignored ', 'chunks'], { ...RESULT, text: 'the authoritative answer' });

        const result = await collectGeneration(handle);

        expect(result.text).toBe('the authoritative answer');
    });

    it('handles a generation that produced no words, only a tool call', async () => {
        const toolOnly: LlmResult = {
            text: '',
            toolCalls: [{ id: 'call_1', name: 'search_catalog', arguments: { query: 'Boards of Canada' } }],
            finishReason: 'tool-calls',
        };
        const { handle } = handleFor([], toolOnly);

        await expect(collectGeneration(handle)).resolves.toEqual(toolOnly);
    });

    it('releases the reader lock, so a caller can still cancel afterwards', async () => {
        const { handle } = handleFor(['a']);

        await collectGeneration(handle);

        // Would throw `TypeError: locked` if the lock were still held.
        await expect(handle.text.cancel()).resolves.toBeUndefined();
    });

    it('propagates a stream that errors rather than hanging', async () => {
        const text = new ReadableStream<string>({
            pull(controller) {
                controller.error(new Error('the model went away'));
            },
        });
        const handle: LlmHandle = { text, result: new Promise(() => {}) };

        await expect(collectGeneration(handle)).rejects.toThrow('the model went away');
    });
});
