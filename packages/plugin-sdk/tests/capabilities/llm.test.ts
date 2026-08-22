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

    // Stopping early is the whole reason the one model slot can be taken back. Without it a caller
    // holding the slot drains whatever the model is saying however long that takes, and the thing
    // waiting for it gives up first.
    describe('stopping early', () => {
        /** A stream that never finishes on its own, which is what a slow model looks like. */
        function endlessHandle(): { handle: LlmHandle; cancelled: () => boolean } {
            let cancelled = false;
            let rejectResult: (error: Error) => void = () => {};
            const result = new Promise<LlmResult>((_resolve, reject) => {
                rejectResult = reject;
            });

            const text = new ReadableStream<string>({
                pull(controller) {
                    controller.enqueue('and another thing ');
                },
                cancel() {
                    cancelled = true;
                    // A real plugin's abort settles the result too, and by rejecting: the
                    // generation did not finish. Nobody is awaiting it on this path, which is
                    // exactly the shape that used to produce an unhandled rejection.
                    rejectResult(new Error('aborted'));
                },
            });

            return { handle: { text, result }, cancelled: () => cancelled };
        }

        it('cancels the stream when the signal fires, which is what stops the plugin', async () => {
            const { handle, cancelled } = endlessHandle();
            const controller = new AbortController();
            const collecting = collectGeneration(handle, controller.signal);

            controller.abort();

            await expect(collecting).rejects.toThrow(/stopped before it finished/);
            expect(cancelled()).toBe(true);
        });

        it('stops a read that is already waiting, rather than one chunk later', async () => {
            // The read is in flight when the signal fires and never comes back on its own. Awaiting
            // it instead of racing it is how a cancellation waits out the very generation it is
            // meant to interrupt.
            let cancelled = false;
            const text = new ReadableStream<string>({
                pull() {
                    return new Promise<void>(() => undefined);
                },
                cancel() {
                    cancelled = true;
                },
            });
            const controller = new AbortController();
            const collecting = collectGeneration({ text, result: new Promise(() => {}) }, controller.signal);

            controller.abort();

            await expect(collecting).rejects.toThrow(/stopped before it finished/);
            expect(cancelled).toBe(true);
        });

        it('does not cancel a generation that finished before the signal was ever used', async () => {
            const { handle } = handleFor(['all ', 'done']);
            const controller = new AbortController();

            await expect(collectGeneration(handle, controller.signal)).resolves.toEqual(RESULT);
        });

        it('leaves no unhandled rejection behind when the result rejects on abort', async () => {
            const rejections: unknown[] = [];
            const onRejection = (reason: unknown) => rejections.push(reason);
            process.on('unhandledRejection', onRejection);

            try {
                const { handle } = endlessHandle();
                const controller = new AbortController();
                const collecting = collectGeneration(handle, controller.signal);
                controller.abort();
                await expect(collecting).rejects.toThrow();

                // Two turns, because an unhandled rejection is reported at the end of a macrotask
                // rather than synchronously with the throw above.
                await new Promise(resolve => setTimeout(resolve, 10));
            } finally {
                process.off('unhandledRejection', onRejection);
            }

            expect(rejections).toEqual([]);
        });
    });
});
