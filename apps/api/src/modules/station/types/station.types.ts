import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * One thing that wants the operator's attention, or the fact that nothing does
 * generated from [AttentionItem](file://./../../../../data/contracts/station/station.types.ck#L8)
 */
export const AttentionItem = z.strictObject({
    code: z
        .string()
        .min(1)
        .max(60)
        .describe(
            'What this is, as a stable key: `silence`, `benchedCopies`, `noPersona`. The console groups and counts on it rather than on the sentence',
        ),
    severity: z
        .enum(['failure', 'warning', 'notice'])
        .describe(
            '`failure` is the station not doing its job, `warning` is something failing beside a station that is working, and `notice` is a thing nobody has set up yet. A notice is not a fault and must not be drawn as one',
        ),
    title: z.string().min(1).max(120).describe('The line an operator reads first'),
    detail: z
        .string()
        .min(1)
        .max(800)
        .describe(
            'The whole of it, in a sentence. Where the station already has words for a fact, these are those words rather than a second phrasing of them',
        ),
    route: z.string().min(1).max(200).describe('The console page that can do something about it'),
    count: z.coerce.number().int().min(0).optional().describe('How many things this is about, where that is a number rather than a state'),
});
export type AttentionItem = z.infer<typeof AttentionItem>;

/**
 * One loop the station runs, and when it last came round.
 *
 * Two timestamps and no verdict, because the loop cannot supply one: a five-second reconcile and a
 * nightly sweep are both healthy and no single threshold describes both. `Heartbeat` itself takes
 * this position — it answers how long it has been and lets the reader decide — and a `stalled`
 * boolean here would be this module inventing the threshold that file deliberately refuses to.
 *
 * `lastBeat` is absent until a loop finishes its first pass, which is why `startedAt` is there: from
 * the two of them a reader can tell a loop that has never completed anything from one that stopped.
 * generated from [StationHeartbeat](file://./../../../../data/contracts/station/station.types.ck#L31)
 */
export const StationHeartbeat = z.strictObject({
    name: z.string().min(1).max(100),
    startedAt: _ZodDatetime.describe('When the loop registered, which is when it was last (re)started'),
    lastBeat: _ZodDatetime.optional().describe('When it last completed a pass. Absent until it completes its first'),
});
export type StationHeartbeat = z.infer<typeof StationHeartbeat>;

export const StationHeartbeatInput = z.strictObject({});
export type StationHeartbeatInput = z.infer<typeof StationHeartbeatInput>;

/**
 * How much of the library the station has actually looked at.
 *
 * The counts `/catalog/tracks` already answers with, lifted out of a page of rows: a check-up wants
 * the sentence "13 of 581 measured" without asking for thirteen tracks to get it.
 * generated from [StationBacklog](file://./../../../../data/contracts/station/station.types.ck#L41)
 */
export const StationBacklog = z.strictObject({
    total: z.coerce.number().int().min(0),
    cached: z.coerce.number().int().min(0),
    measured: z.coerce.number().int().min(0),
});
export type StationBacklog = z.infer<typeof StationBacklog>;

export const StationBacklogInput = z.strictObject({});
export type StationBacklogInput = z.infer<typeof StationBacklogInput>;

/**
 * Everything wrong or waiting, worst first
 * generated from [StationAttention](file://./../../../../data/contracts/station/station.types.ck#L18)
 */
export const StationAttention = z.strictObject({
    items: z.array(AttentionItem),
});
export type StationAttention = z.infer<typeof StationAttention>;

/**
 * One reading of the machinery, for a page that assembles the station's health.
 *
 * It carries ONLY the two signals nothing else exposes. Everything else a check-up shows — the
 * silence verdict, the listener count, what needs somebody, the plugin statuses, the disk — is
 * already on a contract the console reads, and composing them again here would be a second answer
 * that can disagree with the first. `/playout/status` in particular is polled every two seconds for
 * the transport strip, so asking for it a second way would be a second reading of the same fact.
 *
 * Each section is OPTIONAL and absent means that reader failed. A page saying what is wrong is the
 * worst place for one broken reader to take the whole answer down, which is the rule
 * `StationAttentionService` already works to.
 * generated from [StationCheckup](file://./../../../../data/contracts/station/station.types.ck#L58)
 */
export const StationCheckup = z.strictObject({
    readAt: _ZodDatetime.describe('When this reading was taken, so a stale page cannot pass itself off as now'),
    heartbeats: z.array(StationHeartbeat).optional(),
    backlog: StationBacklog.optional(),
});
export type StationCheckup = z.infer<typeof StationCheckup>;

export const StationCheckupInput = z.strictObject({});
export type StationCheckupInput = z.infer<typeof StationCheckupInput>;
