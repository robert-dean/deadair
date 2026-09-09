/**
 * What an audition IS, as shapes with no behaviour.
 *
 * An audition is one persona put through a playlist: one talk break per transition, written one at a
 * time, airing nothing. The rehearsal next door answers "what does this sheet sound like" against a
 * fixed invented pair; this answers "does it hold up over an hour of real records", which is a
 * different question and the one that was previously only answerable by putting the character on air
 * and waiting.
 *
 * Everything here is JSON-safe, because {@link AuditionRecord} and {@link AuditionAttempt} are
 * stored as `jsonb` columns: no `Date`, no class instances, durations as integer milliseconds.
 */

/** How far along a run is. Mirrors the check constraint in migration 0024. */
export type AuditionState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/** Nothing else will be spent on a run in one of these. */
const SETTLED: ReadonlySet<AuditionState> = new Set<AuditionState>(['done', 'failed', 'cancelled']);

/**
 * Whether this run is over, whichever way it went.
 *
 * One predicate rather than the set spelled out at each call site, on `isSettled`'s argument one
 * module over: a caller that forgot `cancelled` would be the exact failure the terminal state exists
 * to prevent, and the console asks the same question to decide whether to keep polling.
 */
export const isAuditionSettled = (state: AuditionState): boolean => SETTLED.has(state);

/**
 * One record of the audition's list, as it was resolved when the operator asked.
 *
 * A snapshot rather than a reference, which is what makes a run repeatable and what keeps it
 * readable after the fact: a provider playlist is edited, reordered and deleted, and an audition
 * whose records were re-read per transition would be two different measurements in one row.
 *
 * The fields are exactly what a writer can be told about a record — see `BreakTrack` — plus the
 * binding that identifies the copy. `artist` is the LEAD rather than the display credit, on
 * `toRundownTracks`' rule: a provider's `artists` array really does have the lead first, which is
 * not true of the catalog's own `artists` column.
 */
export interface AuditionRecord {
    pluginId: string;
    externalId: string;
    title: string;
    artist: string;
    /** The catalog row, when the station holds this copy. What everything interesting hangs off. */
    trackId?: string;
    year?: number;
    album?: string;
    /** Integer milliseconds, on the JSON-safe rule. */
    durationMs?: number;
}

/** One writer's turn at one transition, as the registry reported it. */
export interface AuditionAttempt {
    /** The binding that was asked, as `segments.writer` would record it. */
    writer: string;
    /** `written`, `declined` or `failed`. Declined is the station working; failed is something to fix. */
    outcome: string;
    durationMs: number;
    script?: string;
    reason?: string;
}

/**
 * One transition, and everything the writers said about it.
 *
 * The two records are kept as they were OFFERED, facts and all, rather than by reference into the
 * run's list: what the host said can only be judged against what it was actually told, and by the
 * time anybody reads this the facts have rotated.
 */
export interface AuditionBreak {
    id: string;
    auditionId: string;
    /** Which transition, from 0. */
    ordinal: number;
    previous: AuditionRecord;
    next: AuditionRecord;
    /** Every writer asked, in the order they were asked. */
    attempts: AuditionAttempt[];
    /** The words a listener would have heard. Absent when every writer had nothing. */
    script?: string;
    /** Which writer produced them. Present exactly when {@link script} is. */
    writer?: string;
    /** Why there are none, when there are none. Not a fault: on air this break is skipped. */
    reason?: string;
    createdAt: number;
}

/** A run as it is read back. */
export interface Audition {
    id: string;
    stationKey: string;
    personaId: string;
    personaKey: string;
    sourcePluginId: string;
    sourcePlaylistId: string;
    /** What the playlist was called when the run started. A snapshot, for the console. */
    sourceName?: string;
    records: AuditionRecord[];
    /** How many breaks this run writes: one per transition, so one fewer than the records. */
    transitions: number;
    /** The next transition to write, from 0. What a job claims against. */
    cursor: number;
    state: AuditionState;
    error?: string;
    cancelledAt?: number;
    finishedAt?: number;
    actorId?: string;
    createdAt: number;
}

/** What one transition is written against: the record it follows and the one it leads into. */
export interface AuditionTransition {
    previous: AuditionRecord;
    next: AuditionRecord;
}

/**
 * The two records at one ordinal, or `undefined` when the list does not reach that far.
 *
 * Here rather than in the job so the off-by-one lives in one place: transition `n` sits between
 * records `n` and `n + 1`, which is why a run of six records writes five breaks.
 */
export function transitionAt(records: readonly AuditionRecord[], ordinal: number): AuditionTransition | undefined {
    const previous = records[ordinal];
    const next = records[ordinal + 1];
    if (previous === undefined || next === undefined) return undefined;

    return { previous, next };
}
