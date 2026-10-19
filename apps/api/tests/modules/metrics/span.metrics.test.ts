// The spans are the only source of the work and model trends, so what is pinned is the mapping: which
// op becomes which metric, with which labels, and that a model call that never answered still counts
// its time and its failure while adding no tokens it never reported.

import { describe, expect, it } from 'vitest';
import { MetricsRecorder } from '@maroonedsoftware/telemetry';

import { METRICS } from '../../../src/modules/metrics/metric.names.js';
import { observeSpan, REQUEST_KIND, UNTRACED_KIND } from '../../../src/modules/metrics/span.metrics.js';
import type { RecordedSpan } from '../../../src/modules/shared/trace.spans.js';

const span = (overrides: Partial<RecordedSpan>): RecordedSpan => ({
    op: 'job.run',
    ms: 100,
    outcome: 'ok',
    endedAt: Date.now(),
    trace: { id: 'job-1', kind: 'director.write_break' },
    ...overrides,
});

const observed = (...spans: RecordedSpan[]) => {
    const recorder = new MetricsRecorder();
    for (const s of spans) observeSpan(recorder, s);
    return Object.fromEntries(recorder.drain().map(b => [`${b.name} ${b.labelsKey}`, b.aggregate]));
};

describe('observeSpan', () => {
    it('reads a job run as its queue’s duration', () => {
        expect(observed(span({ op: 'job.run', target: 'catalog.sync', ms: 412 }))).toEqual({
            [`${METRICS.jobMs} {"queue":"catalog.sync"}`]: { count: 1, sum: 412, min: 412, max: 412, last: 412 },
        });
    });

    it('reads a plugin call as its plugin and method', () => {
        const metrics = observed(
            span({ op: 'plugin.invoke', target: 'spotify search', ms: 40 }),
            span({ op: 'plugin.invoke', target: 'spotify search', ms: 60 }),
        );

        expect(metrics[`${METRICS.pluginMs} {"op":"search","plugin":"spotify"}`]).toMatchObject({ count: 2, sum: 100, max: 60 });
    });

    it('reads a model call as its time and its tokens, by decision kind and model', () => {
        const metrics = observed(
            span({
                op: 'llm.generate',
                target: 'anthropic:claude',
                ms: 3000,
                detail: { inputTokens: 1200, outputTokens: 80, reasoningTokens: 0, aborted: false },
            }),
        );
        const labels = '{"kind":"director.write_break","model":"anthropic:claude"}';

        expect(metrics[`${METRICS.modelMs} {"kind":"director.write_break","model":"anthropic:claude","outcome":"ok"}`]?.sum).toBe(3000);
        expect(metrics[`${METRICS.modelInputTokens} ${labels}`]?.sum).toBe(1200);
        expect(metrics[`${METRICS.modelOutputTokens} ${labels}`]?.sum).toBe(80);
        expect(metrics[`${METRICS.modelReasoningTokens} ${labels}`]?.sum).toBe(0);
    });

    it('counts a model call that never answered: its time and its failure, and no tokens', () => {
        const metrics = observed(
            span({ op: 'llm.generate', target: 'm', ms: 30000, outcome: 'failed', error: 'timeout', detail: { aborted: true } }),
        );

        expect(Object.keys(metrics).sort()).toEqual(
            [
                `${METRICS.modelMs} {"kind":"director.write_break","model":"m","outcome":"failed"}`,
                `${METRICS.failed} {"kind":"director.write_break","op":"llm.generate"}`,
            ].sort(),
        );
    });

    it('labels work outside any decision as untraced', () => {
        const metrics = observed(span({ op: 'plugin.invoke', target: 'icecast stats', outcome: 'failed', trace: undefined }));

        expect(metrics[`${METRICS.failed} {"kind":"${UNTRACED_KIND}","op":"plugin.invoke"}`]?.sum).toBe(1);
    });

    it('counts nothing for an op it does not know, even a failed one', () => {
        expect(observed(span({ op: 'something.new', outcome: 'failed' }))).toEqual({});
    });

    it('counts work a request caused under one kind, never under its URL, which carries ids', () => {
        const metrics = observed(
            span({ op: 'llm.generate', target: 'm', trace: { id: 'r-1', kind: 'POST /director/air/items/8f1c/skip-to' } }),
            span({ op: 'llm.generate', target: 'm', outcome: 'failed', trace: { id: 'r-2', kind: 'POST /director/air/items/77aa/skip-to' } }),
        );

        expect(Object.keys(metrics).sort()).toEqual(
            [
                `${METRICS.modelMs} {"kind":"${REQUEST_KIND}","model":"m","outcome":"ok"}`,
                `${METRICS.modelMs} {"kind":"${REQUEST_KIND}","model":"m","outcome":"failed"}`,
                `${METRICS.failed} {"kind":"${REQUEST_KIND}","op":"llm.generate"}`,
            ].sort(),
        );
    });
});
