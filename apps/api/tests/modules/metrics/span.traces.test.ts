// How the station's decisions become OTel traces. The shapes pinned are the ones a trace viewer reads
// wrong without complaint: a job's calls hanging off its root even though the root is filed last, a
// request's calls at the top of their own trace, a queued job linked to the one that queued it rather
// than nested inside it, and times that are the station's own.

import { describe, expect, it } from 'vitest';

import { finishedSpanOf, rootSpanId } from '../../../src/modules/metrics/span.traces.js';
import type { RecordedSpan } from '../../../src/modules/shared/trace.spans.js';

const ENDED = Date.UTC(2026, 9, 17, 12, 0, 1, 500);
const span = (overrides: Partial<RecordedSpan>): RecordedSpan => ({
    op: 'plugin.invoke',
    target: 'spotify search',
    ms: 1500,
    outcome: 'ok',
    endedAt: ENDED,
    trace: { id: 'job-7', kind: 'catalog.sync' },
    ...overrides,
});

describe('finishedSpanOf', () => {
    it('makes a job run the root of its decision’s trace, and its calls children of that root', () => {
        const root = finishedSpanOf(span({ op: 'job.run', target: 'catalog.sync' }));
        const child = finishedSpanOf(span({}));

        expect(root).toMatchObject({ traceId: 'job-7', spanId: rootSpanId('job-7'), name: 'job.run catalog.sync' });
        expect(root?.parentSpanId).toBeUndefined();
        expect(child).toMatchObject({ traceId: 'job-7', parentSpanId: rootSpanId('job-7'), name: 'plugin.invoke spotify search' });
        expect(child?.spanId).not.toBe(root?.spanId);
    });

    it('puts a request’s calls at the top of its trace, since nothing times the request itself', () => {
        expect(finishedSpanOf(span({ trace: { id: 'req-1', kind: 'POST /director/air/extend' } }))?.parentSpanId).toBeUndefined();
    });

    it('links a queued job to the root of the job that queued it, rather than nesting it there', () => {
        const root = finishedSpanOf(span({ op: 'job.run', trace: { id: 'job-8', kind: 'catalog.extract_facts', parent: 'job-7' } }));

        expect(root?.links).toEqual([{ traceId: 'job-7', spanId: rootSpanId('job-7') }]);
        expect(root?.parentSpanId).toBeUndefined();
    });

    it('keeps the station’s own times, a failure’s message, and the detail that is a scalar', () => {
        const finished = finishedSpanOf(
            span({
                op: 'llm.generate',
                target: 'anthropic:claude',
                outcome: 'failed',
                error: 'timeout',
                detail: { inputTokens: 900, aborted: true, nested: { no: 1 } },
            }),
        );

        expect(finished?.end.toMillis()).toBe(ENDED);
        expect(finished?.start.toMillis()).toBe(ENDED - 1500);
        expect(finished).toMatchObject({ ok: false, error: 'timeout' });
        expect(finished?.attributes).toEqual({
            'deadair.decision.kind': 'catalog.sync',
            'deadair.target': 'anthropic:claude',
            'deadair.inputTokens': 900,
            'deadair.aborted': true,
        });
    });

    it('sends nothing for work outside any decision', () => {
        expect(finishedSpanOf(span({ trace: undefined }))).toBeUndefined();
    });
});
