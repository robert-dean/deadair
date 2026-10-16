import type { MetricsRecorder } from '@maroonedsoftware/telemetry';
import type { RecordedSpan } from '#modules/shared/trace.spans.js';
import { METRICS } from './metric.names.js';

/** The `kind` label for work outside any decision: a timer's plugin call, a boot step. */
export const UNTRACED_KIND = 'none';

const tokens = (detail: Record<string, unknown> | undefined, key: string): number | undefined => {
    const value = detail?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

/**
 * Turns one filed span into observations.
 *
 * Every number here was already being measured: `recordSpan` is where the job runner, the plugin
 * invoker and the model loop time their work, so reading it here means no call site measures anything
 * a second time and none of them had to change.
 *
 * - `job.run` is a job's wall clock, labelled by its queue (the span's target).
 * - `plugin.invoke` is one plugin call, labelled by plugin and method (the target is `"<plugin> <op>"`).
 * - `llm.generate` is one model call, labelled by the kind of decision it served and the model, and
 *   carries the tokens the model reported. A call that never answered reports none and adds none; its
 *   duration and its failure are still counted, which is the case the span exists for.
 * - Any failed span counts once in `work.failed`, by `op` and decision kind.
 *
 * Spans of any other `op` are not counted: a new one is added here when somebody wants its trend.
 */
export function observeSpan(recorder: MetricsRecorder, span: RecordedSpan): void {
    const kind = span.trace?.kind ?? UNTRACED_KIND;

    switch (span.op) {
        case 'job.run':
            recorder.observe(METRICS.jobMs, span.ms, { queue: span.target ?? kind });
            break;
        case 'plugin.invoke': {
            const [plugin = 'unknown', op = 'unknown'] = (span.target ?? '').split(' ', 2);
            recorder.observe(METRICS.pluginMs, span.ms, { plugin, op });
            break;
        }
        case 'llm.generate': {
            const labels = { kind, model: span.target ?? 'unknown' };
            recorder.observe(METRICS.modelMs, span.ms, labels);
            const input = tokens(span.detail, 'inputTokens');
            const output = tokens(span.detail, 'outputTokens');
            const reasoning = tokens(span.detail, 'reasoningTokens');
            if (input !== undefined) recorder.observe(METRICS.modelInputTokens, input, labels);
            if (output !== undefined) recorder.observe(METRICS.modelOutputTokens, output, labels);
            if (reasoning !== undefined) recorder.observe(METRICS.modelReasoningTokens, reasoning, labels);
            break;
        }
        default:
            return;
    }

    if (span.outcome === 'failed') {
        recorder.observe(METRICS.failed, 1, { op: span.op, kind });
    }
}
