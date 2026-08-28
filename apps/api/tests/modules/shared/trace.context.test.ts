// The store itself has almost no behaviour, and the two things it does have are the two that would
// be silently wrong: the value has to survive an `await` (an `AsyncLocalStorage` used from the wrong
// place answers `undefined` on the far side of one, and every caller here is async), and code
// outside a trace has to answer rather than throw, because startup work, a plugin's own timer and
// every unit test in this suite all run there.

import { describe, expect, it } from 'vitest';

import { currentTrace, currentTraceId, runInTrace } from '../../../src/modules/shared/trace.context.js';

const tick = () => new Promise(resolve => setImmediate(resolve));

describe('the trace context', () => {
    it('answers nothing outside a trace, rather than throwing', () => {
        expect(currentTrace()).toBeUndefined();
        expect(currentTraceId()).toBeUndefined();
    });

    it('survives an await, which is the only reason it is an AsyncLocalStorage', async () => {
        // Every seam that will read this — the invoker, the model loop, a plugin calling back into
        // its host — is several awaits deep from the job that opened the trace.
        await runInTrace({ id: 'job-1', kind: 'director.refill_lineup' }, async () => {
            await tick();
            await tick();
            expect(currentTraceId()).toBe('job-1');
        });
    });

    it('keeps two concurrent decisions apart', async () => {
        // The failure the whole feature exists for, in miniature: a refill and a break writing at
        // the same time, whose log lines used to be separable only by guessing from timestamps.
        const seen: string[] = [];
        const work = (id: string) =>
            runInTrace({ id, kind: 'k' }, async () => {
                await tick();
                seen.push(currentTraceId() ?? 'none');
                await tick();
                seen.push(currentTraceId() ?? 'none');
            });

        await Promise.all([work('a'), work('b')]);

        expect(seen.filter(s => s === 'a')).toHaveLength(2);
        expect(seen.filter(s => s === 'b')).toHaveLength(2);
    });

    it('does not leak out of the trace it was opened for', async () => {
        await runInTrace({ id: 'job-1', kind: 'k' }, async () => tick());

        expect(currentTraceId()).toBeUndefined();
    });

    it('lets an inner trace win and restores the outer one after it', async () => {
        // Nothing nests today. It is asserted so that the day something does, the answer is the one
        // a reader would assume rather than whichever the implementation happened to give.
        await runInTrace({ id: 'outer', kind: 'k' }, async () => {
            await runInTrace({ id: 'inner', kind: 'k' }, async () => {
                expect(currentTraceId()).toBe('inner');
            });
            expect(currentTraceId()).toBe('outer');
        });
    });

    it('carries the kind as well as the id, for a reader scanning rather than searching', async () => {
        await runInTrace({ id: 'job-1', kind: 'catalog.sync' }, async () => {
            expect(currentTrace()).toEqual({ id: 'job-1', kind: 'catalog.sync' });
        });
    });
});
