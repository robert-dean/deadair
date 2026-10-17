import type { FinishedSpan, SpanAttributeValue } from '@maroonedsoftware/telemetry';
import { DateTime } from 'luxon';
import type { RecordedSpan } from '#modules/shared/trace.spans.js';
import { isRequestKind } from './span.metrics.js';

/**
 * The span id a decision's root is given, so its children can name it before it has ended.
 *
 * A job's `job.run` span is recorded LAST, when the job returns, after every plugin and model call it
 * made. Deriving its id from the decision alone means a child filed first can already point at it,
 * and the backend joins the two whichever arrives first.
 */
export const rootSpanId = (traceId: string): string => `${traceId}:root`;

let sequence = 0;

/** Scalars only: a detail value that is an object or a list says nothing a span attribute can hold. */
function attributesOf(span: RecordedSpan): Record<string, SpanAttributeValue> {
    const attributes: Record<string, SpanAttributeValue> = {};
    if (span.trace !== undefined) attributes['deadair.decision.kind'] = span.trace.kind;
    if (span.target !== undefined) attributes['deadair.target'] = span.target;
    for (const [key, value] of Object.entries(span.detail ?? {})) {
        if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
            attributes[`deadair.${key}`] = value;
        }
    }
    return attributes;
}

/**
 * One filed span as an OTel span, or `undefined` for one outside any decision.
 *
 * Each decision is a trace, keyed by the decision's own id. A job's `job.run` span is the trace's
 * root and every call it made is a child of it. A request has no root span (the middleware opens the
 * decision without timing it), so its calls are top-level spans of the request's trace. A decision a
 * previous one enqueued carries a LINK to that one's root rather than a parent, because it is a
 * separate piece of work in a separate trace, which is what Traces draws as an indented row.
 *
 * Work outside any decision is not sent: the trace file does not keep it either, and a trace of one
 * timer's plugin call answers no question a decision's trace does.
 */
export function finishedSpanOf(span: RecordedSpan): FinishedSpan | undefined {
    const trace = span.trace;
    if (trace === undefined) return undefined;

    const isRoot = span.op === 'job.run';
    const end = DateTime.fromMillis(span.endedAt, { zone: 'utc' });
    sequence = (sequence + 1) % Number.MAX_SAFE_INTEGER;

    return {
        traceId: trace.id,
        spanId: isRoot ? rootSpanId(trace.id) : `${trace.id}:${span.op}:${span.endedAt}:${sequence}`,
        ...(isRoot || isRequestKind(trace.kind) ? {} : { parentSpanId: rootSpanId(trace.id) }),
        name: span.target === undefined ? span.op : `${span.op} ${span.target}`,
        start: end.minus({ milliseconds: span.ms }),
        end,
        ok: span.outcome === 'ok',
        ...(span.error === undefined ? {} : { error: span.error }),
        attributes: attributesOf(span),
        ...(isRoot && trace.parent !== undefined ? { links: [{ traceId: trace.parent, spanId: rootSpanId(trace.parent) }] } : {}),
    };
}
