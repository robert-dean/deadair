// The one count of measurements in flight. What matters is that it holds to the limit it is handed,
// lets the next one in when a slot frees whether the work resolved or threw, and reads the limit per
// call so an operator's change applies without a restart.

import { describe, expect, it } from 'vitest';

import { AnalysisSlots } from '../../../src/modules/analysis/analysis.slots.js';

/** A piece of work the test finishes by hand, and a flag saying whether it has started. */
function held() {
    let finish!: () => void;
    let fail!: (error: Error) => void;
    const state = { started: false };
    const work = () => {
        state.started = true;
        return new Promise<void>((resolve, reject) => {
            finish = resolve;
            fail = reject;
        });
    };
    return { work, state, finish: () => finish(), fail: (error: Error) => fail(error) };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('AnalysisSlots', () => {
    it('starts no more than the limit at once, and the next when one finishes', async () => {
        const slots = new AnalysisSlots();
        const one = held();
        const two = held();

        const first = slots.run(1, one.work);
        const second = slots.run(1, two.work);
        await tick();

        expect(one.state.started).toBe(true);
        expect(two.state.started).toBe(false);

        one.finish();
        await first;
        await tick();
        expect(two.state.started).toBe(true);

        two.finish();
        await second;
        expect(slots.inFlight).toBe(0);
    });

    it('frees the slot when the work throws', async () => {
        const slots = new AnalysisSlots();
        const one = held();
        const two = held();

        const first = slots.run(1, one.work);
        const second = slots.run(1, two.work);
        await tick();

        one.fail(new Error('the decode fell over'));
        await expect(first).rejects.toThrow('the decode fell over');
        await tick();

        expect(two.state.started).toBe(true);
        two.finish();
        await second;
    });

    it('reads the limit per call, so a raised limit admits a waiter at once', async () => {
        const slots = new AnalysisSlots();
        const one = held();
        const two = held();

        void slots.run(1, one.work);
        await tick();
        void slots.run(2, two.work);
        await tick();

        expect(two.state.started).toBe(true);
        expect(slots.inFlight).toBe(2);
        one.finish();
        two.finish();
    });

    it('reads a limit below one as one rather than wedging shut', async () => {
        const slots = new AnalysisSlots();

        await expect(slots.run(0, async () => 'measured')).resolves.toBe('measured');
    });
});
