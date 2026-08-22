// Whether a generation can be STOPPED, which is the half of `LlmHandle.text` no test used to
// cover and which nothing reports when it is wrong: the host cancels, the stream closes, and the
// model carries on holding the one slot until it has finished saying whatever it was saying.

import { describe, expect, it } from 'vitest';

import { abortWith, withCancel } from '../src/llm.abort.js';

/** A stream that keeps producing until somebody stops it, the way a slow model does. */
function endless(onCancel?: () => void): ReadableStream<string> {
    return new ReadableStream<string>({
        pull(controller) {
            controller.enqueue('words ');
        },
        cancel() {
            onCancel?.();
        },
    });
}

describe('abortWith', () => {
    it('aborts when the signal fires later', () => {
        const source = new AbortController();
        const target = new AbortController();
        abortWith(source.signal, target);
        expect(target.signal.aborted).toBe(false);

        source.abort();

        expect(target.signal.aborted).toBe(true);
    });

    it('aborts immediately when the signal has already fired', () => {
        const source = new AbortController();
        source.abort();
        const target = new AbortController();

        abortWith(source.signal, target);

        expect(target.signal.aborted).toBe(true);
    });

    // The host's signal is optional, and a generation with none is not a generation that cannot be
    // stopped — cancelling the stream still reaches the controller.
    it('leaves the controller alone when there is no signal', () => {
        const target = new AbortController();

        abortWith(undefined, target);

        expect(target.signal.aborted).toBe(false);
    });
});

describe('withCancel', () => {
    it('forwards chunks untouched', async () => {
        const source = new ReadableStream<string>({
            start(controller) {
                controller.enqueue('one ');
                controller.enqueue('two');
                controller.close();
            },
        });
        const reader = withCancel(source, () => undefined).getReader();

        const chunks: string[] = [];
        for (let next = await reader.read(); !next.done; next = await reader.read()) chunks.push(next.value);

        expect(chunks.join('')).toBe('one two');
    });

    // The one that matters. The SDK's `textStream` is a tee branch, so cancelling it tells the
    // provider nothing; this is what turns the host's cancel into the plugin's abort.
    it('runs the side effect when the reader cancels', async () => {
        let aborted = false;
        const reader = withCancel(endless(), () => (aborted = true)).getReader();
        await reader.read();

        await reader.cancel();

        expect(aborted).toBe(true);
    });

    it('cancels the source as well, so the branch it wraps is released', async () => {
        let sourceCancelled = false;
        const reader = withCancel(
            endless(() => (sourceCancelled = true)),
            () => undefined,
        ).getReader();
        await reader.read();

        await reader.cancel();

        expect(sourceCancelled).toBe(true);
    });

    // The abort is the point; a source whose own cancel rejects must not be what decides whether
    // the generation was stopped.
    it('still aborts when cancelling the source throws', async () => {
        let aborted = false;
        const source = new ReadableStream<string>({
            pull(controller) {
                controller.enqueue('words ');
            },
            cancel() {
                throw new Error('the branch refused to close');
            },
        });
        const reader = withCancel(source, () => (aborted = true)).getReader();
        await reader.read();

        await expect(reader.cancel()).resolves.toBeUndefined();
        expect(aborted).toBe(true);
    });

    it('does not run the side effect for a stream that simply ended', async () => {
        let aborted = false;
        const source = new ReadableStream<string>({
            start(controller) {
                controller.enqueue('done');
                controller.close();
            },
        });
        const reader = withCancel(source, () => (aborted = true)).getReader();

        while (!(await reader.read()).done) {
            // Drain it to the end.
        }

        expect(aborted).toBe(false);
    });
});
