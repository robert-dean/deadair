/**
 * Whether a call produced what it was asked for. Two values on purpose: every finer distinction —
 * timed out, was preempted, came back empty — is a fact the caller knew and the recorder did not, so
 * it lives in `detail` where it can be named
 * generated from [TraceOutcome](file://./../../../../../apps/api/data/contracts/station/traces.types.ck#L10)
 */
export type TraceOutcome = 'ok' | 'failed';

/**
 * One decision, folded: a job execution or a request
 * generated from [TraceDecision](file://./../../../../../apps/api/data/contracts/station/traces.types.ck#L22)
 */
export interface TraceDecision {
    /** The job id or the request id. Already the station's correlation id, never generated for this */
    id: string;
    /** A queue name, or a method and path */
    kind: string;
    /** The decision that enqueued this one. Absent on a request, a cron job and anything at boot */
    parent?: string;
    /** When its first recorded call ended */
    at: string;
    /** Wall clock, off the `job.run` span. Zero for a decision recorded before that span existed */
    ms: number;
    /** Everything it did, not counting the `job.run` that contains them */
    calls: number;
    /** How many of those did not produce what they were asked for */
    failed: number;
}

/**
 * Which slice of the kept window to read
 * generated from [TracesQuery](file://./../../../../../apps/api/data/contracts/station/traces.types.ck#L32)
 */
export interface TracesQuery {
    limit?: number;
    /** An exact queue name or route, for reading one kind of decision on its own */
    kind?: string;
    /** Only decisions carrying at least one failed call */
    failedOnly?: boolean;
}

/**
 * One call inside a decision, and what it cost
 * generated from [TraceSpan](file://./../../../../../apps/api/data/contracts/station/traces.types.ck#L12)
 */
export interface TraceSpan {
    /** When the call ended, which is when its cost was known */
    at: string;
    /** Dotted and stable: `job.run`, `plugin.invoke`, `llm.generate` */
    op: string;
    /** Which one: a plugin and its method, or a model */
    target?: string;
    /** How long it held, measured around the call rather than reported by it */
    ms: number;
    outcome: TraceOutcome;
    /** The failure, summarized to a shape rather than a stack */
    error?: string;
    /** Whatever this `op` is worth reading back: tokens, a finish reason, the bound it was given */
    detail?: Record<string, unknown>;
}

/**
 * generated from [TracesPage](file://./../../../../../apps/api/data/contracts/station/traces.types.ck#L38)
 */
export interface TracesPage {
    /** Newest first */
    decisions: TraceDecision[];
    /** How many the window holds before `limit`, so a page can say it is showing a slice */
    total: number;
    /** How many calls were read to answer, which is the honest cost of this page */
    spans: number;
}

/**
 * One decision, its calls, and the decisions on either side of it
 * generated from [TraceDetail](file://./../../../../../apps/api/data/contracts/station/traces.types.ck#L44)
 */
export interface TraceDetail {
    decision: TraceDecision;
    /** In the order they happened */
    spans: TraceSpan[];
    /** What enqueued this, when that decision is still inside the kept window */
    parent?: TraceDecision;
    /** What this one went on to enqueue */
    caused: TraceDecision[];
}
