/**
 * `m:ss`, or `h:mm:ss` from an hour up. Not a date library: the input is a duration in milliseconds,
 * not a point in time.
 *
 * It was minutes only, on the argument that nothing here is ever longer than a single track, and
 * that stopped being true when the station started carrying somebody else's programmes: an hour and a
 * half of a podcast read `90:00` on the Podcasts page and, worse, on the desk's elapsed and remaining
 * counters while it aired. A record reads exactly as it always did.
 *
 * An absent duration renders as nothing rather than `0:00`, which would claim a length the
 * catalog does not know.
 */
export function formatDuration(durationMs: number | undefined): string {
    if (durationMs === undefined) {
        return '';
    }
    const totalSeconds = Math.round(durationMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const ss = seconds.toString().padStart(2, '0');
    return hours > 0 ? `${hours}:${minutes.toString().padStart(2, '0')}:${ss}` : `${minutes}:${ss}`;
}
