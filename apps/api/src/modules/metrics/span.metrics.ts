import type { MetricsRecorder } from '@maroonedsoftware/telemetry';
import type { RecordedSpan } from '#modules/shared/trace.spans.js';
import { METRICS } from './metric.names.js';
import { callCost, type ModelPrice } from './usage.prices.js';

/** The `kind` label for work outside any decision: a timer's plugin call, a boot step. */
export const UNTRACED_KIND = 'none';

/** The `kind` label for work a console or API request caused. */
export const REQUEST_KIND = 'request';

/**
 * Whether a decision is an HTTP request. A request's trace kind is its method and path
 * (`authorization.context.middleware.ts`), and the path carries ids.
 */
export const isRequestKind = (kind: string): boolean => /^[A-Z]+ \//.test(kind);

/**
 * The `kind` label a span's decision is counted under.
 *
 * A job's kind is its queue name, one of a closed set, and is kept. A request's is its method and
 * path, `POST /director/air/items/<id>/skip-to`, which would make every id in a URL a new series per
 * minute, so every request is counted as one kind. Which route it was is what Traces is for.
 */
export function kindLabel(span: Pick<RecordedSpan, 'trace'>): string {
    const kind = span.trace?.kind;
    if (kind === undefined) return UNTRACED_KIND;
    return isRequestKind(kind) ? REQUEST_KIND : kind;
}

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
 *   duration and its failure are still counted, which is the case the span exists for. Its duration
 *   is labelled by `outcome` too, because a mean across both answers neither question: one 120 s
 *   timeout among twenty 3 s answers reads as a 9 s model, and a down model's instant refusals read
 *   as a fast one. The tokens carry no outcome, since a failed call adds none to split.
 *   With a price for that model, the call's cost is counted too, at that price, so a price changed
 *   later moves only what comes after it.
 * - Any failed span counts once in `work.failed`, by `op` and decision kind.
 *
 * The decision kind is {@link kindLabel}'s, so a request counts as `request` and never as its URL.
 *
 * Spans of any other `op` are not counted: a new one is added here when somebody wants its trend.
 */
export function observeSpan(
    recorder: MetricsRecorder,
    span: RecordedSpan,
    priceOf: (model: string) => ModelPrice | undefined = () => undefined,
): void {
    const kind = kindLabel(span);

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
            recorder.observe(METRICS.modelMs, span.ms, { ...labels, outcome: span.outcome });
            const input = tokens(span.detail, 'inputTokens');
            const output = tokens(span.detail, 'outputTokens');
            const reasoning = tokens(span.detail, 'reasoningTokens');
            if (input !== undefined) recorder.observe(METRICS.modelInputTokens, input, labels);
            if (output !== undefined) recorder.observe(METRICS.modelOutputTokens, output, labels);
            if (reasoning !== undefined) recorder.observe(METRICS.modelReasoningTokens, reasoning, labels);
            const cost = callCost(priceOf(labels.model), input, output);
            if (cost !== undefined) recorder.observe(METRICS.modelCost, cost, labels);
            break;
        }
        default:
            return;
    }

    if (span.outcome === 'failed') {
        recorder.observe(METRICS.failed, 1, { op: span.op, kind });
    }
}
