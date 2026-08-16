// Three claims, the same three `LlmGate` makes, minus the one that does not apply.
//
// 1. One synthesis at a time. Before this the property held only because pg-boss puts one worker on
//    the `render.segment` queue, which said nothing about a voice preview arriving beside it.
// 2. Giving up in the queue is honest, and only a caller that asked for a bound ever does it.
// 3. The slot always comes back. A leaked one stops the station speaking ever again and presents as
//    a hung engine rather than as a bug, so every ending is asserted separately.
//
// There is deliberately no drain test here, unlike the model's gate: a synthesis is finished when
// the call that made it is, because `SpeechService` writes the audio to the store before returning.

import { describe, expect, it, vi } from 'vitest';
import { isPluginError } from '@deadair/plugin-sdk';

import { SpeechGate } from '../../../src/modules/render/speech.gate.js';

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as never;

const gate = () => new SpeechGate(logger());

/** A promise a test settles by hand, so it decides exactly when the engine is finished. */
function deferred<T = void>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}

/** Let anything already queued on the microtask queue run. */
const settle = () => new Promise(resolve => setImmediate(resolve));

describe('SpeechGate', () => {
    it('runs one synthesis at a time', async () => {
        const speech = gate();
        const first = deferred();
        const started: string[] = [];

        const one = speech.hold(async () => {
            started.push('one');
            await first.promise;
        });
        const two = speech.hold(async () => {
            started.push('two');
        });

        await settle();
        expect(started).toEqual(['one']);
        expect(speech.speaking()).toBe(true);
        expect(speech.depth()).toBe(1);

        first.resolve();
        await Promise.all([one, two]);
        expect(started).toEqual(['one', 'two']);
    });

    it('gives the slot back when the work throws, so one bad render does not silence the station', async () => {
        const speech = gate();

        await expect(
            speech.hold(async () => {
                throw new Error('the engine refused');
            }),
        ).rejects.toThrow('the engine refused');

        expect(speech.speaking()).toBe(false);
        expect(speech.depth()).toBe(0);

        // And the next caller gets straight in.
        await expect(speech.hold(async () => 'spoken')).resolves.toBe('spoken');
    });

    it('waits indefinitely when no bound was asked for, because nobody is waiting on a render', async () => {
        const speech = gate();
        const first = deferred();
        let ran = false;

        const one = speech.hold(async () => await first.promise);
        const two = speech.hold(async () => {
            ran = true;
        });

        await settle();
        expect(ran).toBe(false);

        first.resolve();
        await Promise.all([one, two]);
        expect(ran).toBe(true);
    });

    it('gives up in the queue for a caller that set a bound, having spent nothing', async () => {
        const speech = gate();
        const first = deferred();
        let ran = false;

        const one = speech.hold(async () => await first.promise);
        const waited = speech
            .hold(
                async () => {
                    ran = true;
                },
                { maxWaitMs: 10 },
            )
            .catch((error: unknown) => error);

        const error = await waited;
        expect(isPluginError(error) && error.code).toBe('timeout');
        // The whole point of giving up in the QUEUE: the engine was never asked.
        expect(ran).toBe(false);

        first.resolve();
        await one;
    });

    it('does not also time out a caller that got in first', async () => {
        const speech = gate();
        const first = deferred();
        let spoke = false;

        const one = speech.hold(async () => await first.promise);
        const two = speech.hold(
            async () => {
                spoke = true;
            },
            { maxWaitMs: 50 },
        );

        // Admitted well inside its own bound, then allowed to take longer than it: the bound is on
        // the queue and stops applying the moment the engine is handed over.
        first.resolve();
        await two;
        await one;

        expect(spoke).toBe(true);
        await settle();
        expect(speech.speaking()).toBe(false);
    });

    it('hands the slot to the caller that waited longest', async () => {
        const speech = gate();
        const first = deferred();
        const order: string[] = [];

        const one = speech.hold(async () => await first.promise);
        const two = speech.hold(async () => {
            order.push('two');
        });
        const three = speech.hold(async () => {
            order.push('three');
        });

        expect(speech.depth()).toBe(2);

        first.resolve();
        await Promise.all([one, two, three]);
        expect(order).toEqual(['two', 'three']);
    });
});
