// The parent link rides in the job payload because nothing else travels between two decisions that
// may run minutes apart on different workers. That makes the payload the risk: a reserved key that
// leaks into a job's own `execute` is a field somebody eventually branches on, and a key that fails
// to come off is worse than no link at all.

import { describe, expect, it } from 'vitest';

import { PARENT_TRACE_KEY, takeParentTrace, withParentTrace } from '../../../src/modules/jobs/job.trace.payload.js';
import { runInTrace } from '../../../src/modules/shared/trace.context.js';

describe('withParentTrace', () => {
    it('stamps the decision doing the enqueueing', async () => {
        await runInTrace({ id: 'job-parent', kind: 'catalog.enrich' }, async () => {
            expect(withParentTrace({ trackId: 't1' })).toEqual({ trackId: 't1', [PARENT_TRACE_KEY]: 'job-parent' });
        });
    });

    it('leaves a payload alone outside a trace', () => {
        // Boot scheduling, and anything a plugin does on a timer of its own. Both are roots, and a
        // blank parent would read as an edge to nowhere.
        expect(withParentTrace({ trackId: 't1' })).toEqual({ trackId: 't1' });
    });

    it('copies rather than mutating what the caller handed it', async () => {
        // A caller that reuses one object across two sends would otherwise have its second send
        // carry the first's parent, and would be reading its own argument back changed.
        const payload = { trackId: 't1' };

        await runInTrace({ id: 'job-parent', kind: 'k' }, async () => {
            withParentTrace(payload);
        });

        expect(payload).toEqual({ trackId: 't1' });
    });

    it('keeps the original parent when an already-stamped payload is re-enqueued', async () => {
        // A retry that re-sends what it received. The decision that FIRST asked for the work is the
        // one that caused it; overwriting would make the chain say the retry invented the work.
        await runInTrace({ id: 'job-second', kind: 'k' }, async () => {
            expect(withParentTrace({ trackId: 't1', [PARENT_TRACE_KEY]: 'job-first' })).toEqual({
                trackId: 't1',
                [PARENT_TRACE_KEY]: 'job-first',
            });
        });
    });
});

describe('takeParentTrace', () => {
    it('lifts the parent out and hands back the payload the job was sent', () => {
        expect(takeParentTrace({ trackId: 't1', [PARENT_TRACE_KEY]: 'job-parent' })).toEqual({
            payload: { trackId: 't1' },
            parent: 'job-parent',
        });
    });

    it('leaves an unstamped payload untouched and names no parent', () => {
        // Cron. A scheduled row is written once and fires forever, so it can never carry one.
        expect(takeParentTrace({ trackId: 't1' })).toEqual({ payload: { trackId: 't1' } });
    });

    it('answers for a job that was sent nothing at all', () => {
        expect(takeParentTrace(undefined)).toEqual({ payload: undefined });
    });

    it('survives the NULL a cron job actually arrives with', () => {
        // Not hypothetical and not `undefined`. pg-boss delivers an absent payload as `null` while
        // the runner types it `Payload | undefined`, so `'__trace' in null` threw a TypeError and
        // took `ScheduleTickJob` down on the first boot after the link was written — before its
        // `execute` was ever reached. The signature is not evidence about the value.
        expect(takeParentTrace(null as never)).toEqual({ payload: null });
    });

    it('survives a payload that is not an object at all', () => {
        expect(takeParentTrace('surprise' as never)).toEqual({ payload: 'surprise' });
    });

    it('strips a colliding key of the wrong type without inventing a parent from it', () => {
        // Somebody else's `__trace` that happens to be a number. Recording it would put a
        // non-id in the parent column; leaving it on would hand a job a field it did not send.
        expect(takeParentTrace({ trackId: 't1', [PARENT_TRACE_KEY]: 42 })).toEqual({ payload: { trackId: 't1' } });
    });

    it('round-trips: what a send stamps is exactly what a run takes off', async () => {
        // The property that matters, and the one that would break silently if either half were
        // edited alone.
        const sent = { segmentId: 's1', kind: 'talk' };
        let onWire: object = {};

        await runInTrace({ id: 'job-parent', kind: 'k' }, async () => {
            onWire = withParentTrace(sent);
        });

        expect(takeParentTrace(onWire)).toEqual({ payload: sent, parent: 'job-parent' });
    });
});
