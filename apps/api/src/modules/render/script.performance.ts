import type { ScriptPerformanceRow } from './types/render.types.js';

/**
 * What a character's decline reason ends with when the fault can name the wording that caused it.
 *
 * Written by the answer guard and cut off by {@link ScriptHistoryRepository.performanceSince}, so the
 * same fault counts as one line however many different things it quoted.
 */
export const DECLINE_QUOTE_MARK = ': it said "';

/** One grouped row of the history, with the rating as the column holds it. */
export interface ScriptPerformanceCount {
    personaKey?: string;
    kind: string;
    outcome: string;
    reason?: string;
    rating?: number;
    count: number;
}

/**
 * The grouped counts, folded into one row per persona and kind.
 *
 * Decline reasons come most common first. A rating of an attempt that was not written cannot be made
 * from the console, and is counted all the same if one exists: it is still what the operator said.
 */
export function foldPerformance(counts: readonly ScriptPerformanceCount[]): ScriptPerformanceRow[] {
    const rows = new Map<string, { row: ScriptPerformanceRow; reasons: Map<string, number> }>();

    for (const { personaKey, kind, outcome, reason, rating, count } of counts) {
        const key = JSON.stringify([personaKey ?? '', kind]);
        const held = rows.get(key) ?? {
            row: {
                ...(personaKey === undefined ? {} : { personaKey }),
                kind,
                written: 0,
                declined: 0,
                failed: 0,
                liked: 0,
                neutral: 0,
                disliked: 0,
                declineReasons: [],
            },
            reasons: new Map<string, number>(),
        };
        rows.set(key, held);

        if (outcome === 'written') held.row.written += count;
        if (outcome === 'failed') held.row.failed += count;
        if (outcome === 'declined') {
            held.row.declined += count;
            if (reason !== undefined) held.reasons.set(reason, (held.reasons.get(reason) ?? 0) + count);
        }

        if (rating !== undefined) {
            if (rating > 0) held.row.liked += count;
            else if (rating < 0) held.row.disliked += count;
            else held.row.neutral += count;
        }
    }

    return [...rows.values()].map(({ row, reasons }) => ({
        ...row,
        declineReasons: [...reasons.entries()]
            .map(([reason, count]) => ({ reason, count }))
            .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    }));
}
