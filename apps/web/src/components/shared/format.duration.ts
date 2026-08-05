/**
 * `m:ss`, not a date library: the input is a duration in milliseconds, not a point in time, and
 * the format never needs to grow past minutes for a single track.
 *
 * An absent duration renders as nothing rather than `0:00`, which would claim a length the
 * catalog does not know.
 */
export function formatDuration(durationMs: number | undefined): string {
    if (durationMs === undefined) {
        return '';
    }
    const totalSeconds = Math.round(durationMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
