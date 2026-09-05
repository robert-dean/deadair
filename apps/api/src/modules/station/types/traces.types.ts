import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * Whether a call produced what it was asked for. Two values on purpose: every finer distinction —
 * timed out, was preempted, came back empty — is a fact the caller knew and the recorder did not, so
 * it lives in `detail` where it can be named
 * generated from [TraceOutcome](../../../../data/contracts/station/traces.types.ck#L10)
 */
export const TraceOutcome = z.enum(['ok', 'failed']);
export type TraceOutcome = z.infer<typeof TraceOutcome>;

/**
 * One decision, folded: a job execution or a request
 * generated from [TraceDecision](../../../../data/contracts/station/traces.types.ck#L22)
 */
export const TraceDecision = z.strictObject({
    id: z.string().min(1).max(200).describe("The job id or the request id. Already the station's correlation id, never generated for this"),
    kind: z.string().min(1).max(200).describe('A queue name, or a method and path'),
    parent: z.string().max(200).optional().describe('The decision that enqueued this one. Absent on a request, a cron job and anything at boot'),
    at: _ZodDatetime.describe('When its first recorded call ended'),
    ms: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe('Wall clock, off the `job.run` span. Zero for a decision recorded before that span existed'),
    calls: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe('Everything it did, not counting the `job.run` that contains them'),
    failed: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe('How many of those did not produce what they were asked for'),
});
export type TraceDecision = z.infer<typeof TraceDecision>;

/**
 * Which slice of the kept window to read
 * generated from [TracesQuery](../../../../data/contracts/station/traces.types.ck#L32)
 */
export const TracesQuery = z.strictObject({
    limit: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1).max(200)).optional(),
    kind: z.string().max(200).optional().describe('An exact queue name or route, for reading one kind of decision on its own'),
    failedOnly: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .optional()
        .describe('Only decisions carrying at least one failed call'),
});
export type TracesQuery = z.infer<typeof TracesQuery>;

/**
 * One call inside a decision, and what it cost
 * generated from [TraceSpan](../../../../data/contracts/station/traces.types.ck#L12)
 */
export const TraceSpan = z.strictObject({
    at: _ZodDatetime.describe('When the call ended, which is when its cost was known'),
    op: z.string().min(1).max(100).describe('Dotted and stable: `job.run`, `plugin.invoke`, `llm.generate`'),
    target: z.string().max(300).optional().describe('Which one: a plugin and its method, or a model'),
    ms: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe('How long it held, measured around the call rather than reported by it'),
    outcome: TraceOutcome,
    error: z.string().max(300).optional().describe('The failure, summarized to a shape rather than a stack'),
    detail: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Whatever this `op` is worth reading back: tokens, a finish reason, the bound it was given'),
});
export type TraceSpan = z.infer<typeof TraceSpan>;

/**
 * generated from [TracesPage](../../../../data/contracts/station/traces.types.ck#L38)
 */
export const TracesPage = z.strictObject({
    decisions: z.array(TraceDecision).describe('Newest first'),
    total: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe('How many the window holds before `limit`, so a page can say it is showing a slice'),
    spans: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe('How many calls were read to answer, which is the honest cost of this page'),
});
export type TracesPage = z.infer<typeof TracesPage>;

/**
 * One decision, its calls, and the decisions on either side of it
 * generated from [TraceDetail](../../../../data/contracts/station/traces.types.ck#L44)
 */
export const TraceDetail = z.strictObject({
    decision: TraceDecision,
    spans: z.array(TraceSpan).describe('In the order they happened'),
    parent: TraceDecision.optional().describe('What enqueued this, when that decision is still inside the kept window'),
    caused: z.array(TraceDecision).describe('What this one went on to enqueue'),
});
export type TraceDetail = z.infer<typeof TraceDetail>;
