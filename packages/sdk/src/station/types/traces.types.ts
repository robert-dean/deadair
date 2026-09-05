import { Decimal } from 'decimal.js';
import { DateTime } from 'luxon';

Decimal.set({ toExpNeg: -9e15, toExpPos: 9e15 });
const __dt = (v: unknown, path: string): DateTime => {
    if (typeof v !== 'string') {
        throw new TypeError(`ContractKit: expected an ISO 8601 string at '${path}', received ${typeof v}.`);
    }
    const d = DateTime.fromISO(v);
    if (!d.isValid) throw new TypeError(`ContractKit: '${v}' at '${path}' is not a valid ISO 8601 datetime.`);
    return d;
};

/**
 * Whether a call produced what it was asked for. Two values on purpose: every finer distinction —
 * timed out, was preempted, came back empty — is a fact the caller knew and the recorder did not, so
 * it lives in `detail` where it can be named
 * generated from [TraceOutcome](../../../../../apps/api/data/contracts/station/traces.types.ck#L10)
 */
export type TraceOutcome = 'ok' | 'failed';

/**
 * One decision, folded: a job execution or a request
 * generated from [TraceDecision](../../../../../apps/api/data/contracts/station/traces.types.ck#L22)
 */
export interface TraceDecision {
    /** The job id or the request id. Already the station's correlation id, never generated for this */
    id: string;
    /** A queue name, or a method and path */
    kind: string;
    /** The decision that enqueued this one. Absent on a request, a cron job and anything at boot */
    parent?: string;
    /** When its first recorded call ended */
    at: DateTime;
    /** Wall clock, off the `job.run` span. Zero for a decision recorded before that span existed */
    ms: number;
    /** Everything it did, not counting the `job.run` that contains them */
    calls: number;
    /** How many of those did not produce what they were asked for */
    failed: number;
}

/** Rehydrates every wire-encoded scalar in a TraceDecision into its runtime type. Mutates and returns `raw`. */
export function reviveTraceDecision(raw: TraceDecision): TraceDecision {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['at'] = __dt(__o0['at'], 'TraceDecision.at');
    return raw;
}

/**
 * Which slice of the kept window to read
 * generated from [TracesQuery](../../../../../apps/api/data/contracts/station/traces.types.ck#L32)
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
 * generated from [TraceSpan](../../../../../apps/api/data/contracts/station/traces.types.ck#L12)
 */
export interface TraceSpan {
    /** When the call ended, which is when its cost was known */
    at: DateTime;
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

/** Rehydrates every wire-encoded scalar in a TraceSpan into its runtime type. Mutates and returns `raw`. */
export function reviveTraceSpan(raw: TraceSpan): TraceSpan {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['at'] = __dt(__o0['at'], 'TraceSpan.at');
    return raw;
}

/**
 * generated from [TracesPage](../../../../../apps/api/data/contracts/station/traces.types.ck#L38)
 */
export interface TracesPage {
    /** Newest first */
    decisions: TraceDecision[];
    /** How many the window holds before `limit`, so a page can say it is showing a slice */
    total: number;
    /** How many calls were read to answer, which is the honest cost of this page */
    spans: number;
}

/** Rehydrates every wire-encoded scalar in a TracesPage into its runtime type. Mutates and returns `raw`. */
export function reviveTracesPage(raw: TracesPage): TracesPage {
    const __o0 = raw as unknown as Record<string, unknown>;
    {
        const __a1 = __o0['decisions'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveTraceDecision(__a1[__i2] as never);
        }
    }
    return raw;
}

/**
 * One decision, its calls, and the decisions on either side of it
 * generated from [TraceDetail](../../../../../apps/api/data/contracts/station/traces.types.ck#L44)
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

/** Rehydrates every wire-encoded scalar in a TraceDetail into its runtime type. Mutates and returns `raw`. */
export function reviveTraceDetail(raw: TraceDetail): TraceDetail {
    const __o0 = raw as unknown as Record<string, unknown>;
    reviveTraceDecision(__o0['decision'] as never);
    {
        const __a1 = __o0['spans'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveTraceSpan(__a1[__i2] as never);
        }
    }
    if (__o0['parent'] != null) {
        reviveTraceDecision(__o0['parent'] as never);
    }
    {
        const __a3 = __o0['caused'] as unknown[];
        for (let __i4 = 0; __i4 < __a3.length; __i4++) {
            reviveTraceDecision(__a3[__i4] as never);
        }
    }
    return raw;
}
