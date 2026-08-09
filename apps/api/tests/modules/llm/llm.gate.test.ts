// Three claims, and the first two were paid for in production in the previous station.
//
// 1. The slot is held until the WORDS stop, not until the call resolves. Releasing on the resolved
//    call let two generations overlap under streaming, and nothing about the gate looked wrong.
// 2. The budget starts at admission, not at enqueue, so queue wait does not count against the work.
//    Before that, a busy station aborted every generation into its fallback.
// 3. The slot always comes back. A leaked one stops the station generating anything ever again and
//    presents as a hung model rather than as a bug, so every ending is asserted separately.

import { describe, expect, it, vi } from 'vitest';
import { isPluginError } from '@deadair/plugin-sdk';

import { LlmGate, type GatedGeneration } from '../../../src/modules/llm/llm.gate.js';

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as never;

const gate = () => new LlmGate(logger());

/** A stream fed by hand, so a test decides exactly when the words stop. */
function manualStream() {
    let controller!: ReadableStreamDefaultController<string>;
    const stream = new ReadableStream<string>({
        start(c) {
            controller = c;
        },
    });

    return {
        stream,
        push: (value: string) => controller.enqueue(value),
        finish: () => controller.close(),
        fail: (error: unknown) => controller.error(error),
    };
}

/** Read a stream to the end, discarding it. */
async function drain(stream: ReadableStream<string>): Promise<void> {
    const reader = stream.getReader();
    try {
        while (!(await reader.read()).done) {
            // Reading for the effect, not the words.
        }
    } finally {
        reader.releaseLock();
    }
}

const gated = (stream: ReadableStream<string>, result: unknown = 'done'): GatedGeneration<unknown> => ({
    stream,
    result: Promise.resolve(result),
});

describe('holding the slot until the words stop', () => {
    it('does not admit a second generation while the first is still producing', async () => {
        const subject = gate();
        const first = manualStream();
        const secondStarted = vi.fn();

        const one = await subject.run(async () => gated(first.stream));

        // The call has RESOLVED. This is the exact moment the old bug released the slot.
        const two = subject.run(async () => {
            secondStarted();
            return gated(manualStream().stream);
        });

        first.push('still talking');
        await Promise.resolve();
        expect(secondStarted).not.toHaveBeenCalled();
        expect(subject.depth()).toBe(1);

        first.finish();
        await drain(one.stream);
        await two;

        expect(secondStarted).toHaveBeenCalledOnce();
    });

    it('admits the next one as soon as the words stop', async () => {
        const subject = gate();
        const first = manualStream();

        const one = await subject.run(async () => gated(first.stream));
        const two = subject.run(async () => gated(manualStream().stream));

        first.finish();
        await drain(one.stream);

        await expect(two).resolves.toBeDefined();
        expect(subject.generating()).toBe(true);
    });

    it('hands the slot over in arrival order rather than letting a newcomer take it', async () => {
        const subject = gate();
        const first = manualStream();
        const admitted: string[] = [];

        const one = await subject.run(async () => gated(first.stream));
        const two = subject.run(async () => {
            admitted.push('two');
            return gated(manualStream().stream);
        });
        const three = subject.run(async () => {
            admitted.push('three');
            return gated(manualStream().stream);
        });

        expect(subject.depth()).toBe(2);

        first.finish();
        await drain(one.stream);
        await two;

        expect(admitted).toEqual(['two']);

        void three;
    });
});

describe('giving the slot back, however the generation ended', () => {
    it('releases when the stream finishes', async () => {
        const subject = gate();
        const first = manualStream();

        const one = await subject.run(async () => gated(first.stream));
        first.finish();
        await drain(one.stream);

        expect(subject.generating()).toBe(false);
    });

    it('releases when the stream errors mid-answer', async () => {
        const subject = gate();
        const first = manualStream();

        const one = await subject.run(async () => gated(first.stream));
        first.push('half a');
        first.fail(new Error('the model went away'));

        await expect(drain(one.stream)).rejects.toThrow('the model went away');
        expect(subject.generating()).toBe(false);
    });

    it('releases when the reader gives up', async () => {
        const subject = gate();
        const first = manualStream();

        const one = await subject.run(async () => gated(first.stream));
        first.push('a');
        await one.stream.cancel();

        expect(subject.generating()).toBe(false);
    });

    it('releases when starting the work throws, before any stream exists', async () => {
        const subject = gate();

        await expect(
            subject.run(async () => {
                throw new Error('the plugin refused');
            }),
        ).rejects.toThrow('the plugin refused');

        expect(subject.generating()).toBe(false);
    });

    it('lets the next caller in after a failure, rather than wedging the station', async () => {
        const subject = gate();

        await expect(
            subject.run(async () => {
                throw new Error('nope');
            }),
        ).rejects.toThrow();

        const after = manualStream();
        const two = await subject.run(async () => gated(after.stream));

        expect(two).toBeDefined();
    });
});

describe('the budget', () => {
    it('starts at admission rather than at enqueue', async () => {
        // The claim that matters. Two waits a short budget apart: if the clock had started when the
        // second caller joined the queue, it would already be spent by the time it was admitted.
        vi.useFakeTimers();
        try {
            const subject = gate();
            const first = manualStream();
            const second = manualStream();

            const one = await subject.run(async () => gated(first.stream), { budgetMs: 1_000 });
            const two = subject.run(async () => gated(second.stream), { budgetMs: 1_000 });

            // Long enough that a budget started at enqueue would be gone.
            await vi.advanceTimersByTimeAsync(5_000);

            first.finish();
            await drain(one.stream);

            const admitted = await two;
            second.push('a word');
            second.finish();

            // Reads clean: its budget began when it was let in, not when it started waiting.
            await expect(drain(admitted.stream)).resolves.toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });

    it('ends a generation that keeps producing past its budget', async () => {
        vi.useFakeTimers();
        try {
            const subject = gate();
            const endless = manualStream();

            const one = await subject.run(async () => gated(endless.stream), { budgetMs: 1_000 });

            endless.push('a');
            await vi.advanceTimersByTimeAsync(1_500);
            endless.push('b');

            await expect(drain(one.stream)).rejects.toSatisfy(error => isPluginError(error) && error.code === 'timeout');
            // And the slot came back, which is the half that keeps the station alive.
            expect(subject.generating()).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('leaves a generation alone when it finishes inside its budget', async () => {
        vi.useFakeTimers();
        try {
            const subject = gate();
            const quick = manualStream();

            const one = await subject.run(async () => gated(quick.stream), { budgetMs: 10_000 });
            quick.push('done in time');
            quick.finish();

            await expect(drain(one.stream)).resolves.toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('giving up in the queue', () => {
    it('rejects with `timeout` after maxWaitMs, before anything is spent', async () => {
        vi.useFakeTimers();
        try {
            const subject = gate();
            const first = manualStream();
            const started = vi.fn();

            const one = await subject.run(async () => gated(first.stream));
            // Captured rather than asserted later: with fake timers the rejection lands before an
            // `await expect(...)` could attach, and an unhandled one fails the run.
            const two = subject
                .run(
                    async () => {
                        started();
                        return gated(manualStream().stream);
                    },
                    { maxWaitMs: 500 },
                )
                .then(
                    () => undefined,
                    (error: unknown) => error,
                );

            await vi.advanceTimersByTimeAsync(1_000);

            const refusal = await two;
            expect(isPluginError(refusal) && refusal.code === 'timeout').toBe(true);
            // Never admitted, so no model time and no money went anywhere.
            expect(started).not.toHaveBeenCalled();
            expect(subject.depth()).toBe(0);

            first.finish();
            await drain(one.stream);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not hand the slot to a caller that already gave up', async () => {
        vi.useFakeTimers();
        try {
            const subject = gate();
            const first = manualStream();

            const one = await subject.run(async () => gated(first.stream));
            const two = subject
                .run(async () => gated(manualStream().stream), { maxWaitMs: 500 })
                .then(
                    () => undefined,
                    (error: unknown) => error,
                );

            await vi.advanceTimersByTimeAsync(1_000);
            expect(await two).toBeDefined();

            first.finish();
            await drain(one.stream);

            // The queue is empty and the model is free, rather than held for a ghost.
            expect(subject.generating()).toBe(false);
            expect(subject.depth()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('admits a waiter that arrives within its patience', async () => {
        vi.useFakeTimers();
        try {
            const subject = gate();
            const first = manualStream();

            const one = await subject.run(async () => gated(first.stream));
            const two = subject.run(async () => gated(manualStream().stream), { maxWaitMs: 10_000 });

            await vi.advanceTimersByTimeAsync(100);
            first.finish();
            await drain(one.stream);

            await expect(two).resolves.toBeDefined();
        } finally {
            vi.useRealTimers();
        }
    });
});
