/**
 * A duration where the interesting range spans four orders of magnitude.
 *
 * `formatDuration` is `m:ss` and is right for a record; it is useless for work, where the honest
 * answers are "3ms" and "19.2s" on adjacent rows. Sub-second stays in milliseconds because a plugin
 * call that took 40ms and one that took 400 are a different conversation, and anything past a second
 * rounds to a tenth because nobody reading a 19-second generation cares about its last 43.
 *
 * Shared by Traces, which reads one decision's calls, and Trends, which reads their means over time.
 */
export function formatSpent(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;

    return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}
