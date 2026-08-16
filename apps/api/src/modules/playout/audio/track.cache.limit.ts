/**
 * How much disk the station's own copies of records may take up.
 *
 * Every record the station fetches is kept — the `playout.trackCache` switch that used to make that
 * optional is gone, because a record may not be committed to the running order until its audio is on
 * this machine, so a station keeping nothing would never commit anything. The cost of that decision
 * is that `TRACKS_DIR` grows for as long as the station runs, and the ceiling is not the operator's
 * library: `PickResolver` ingests records from providers that were never in a playlist, so the set
 * of records the station can fetch is the provider's catalogue.
 *
 * This is the cap that bounds it, and the sweep in {@link TrackAudioService} is what enforces it.
 * See `docs/todo/track-cache-eviction.md`.
 *
 * Kept beside the audio it bounds rather than in `settings.registry.ts`, exactly as `gain.ts` and
 * `air.mode.ts` are: the registry declares the FORM, and the typed resolver lives with the code that
 * reads the value, so the two share a default and cannot disagree about it.
 */

/** The `deadair.settings` key. Dot-keyed, like every other setting. */
export const TRACK_CACHE_MAX_BYTES_KEY = 'playout.trackCacheMaxBytes';

/**
 * No cap, which is what the station has always done.
 *
 * Zero rather than some cautious number of gigabytes, and it has to stay reachable: an operator with
 * a 4 TB volume and a small library is better served by keeping everything, and a default that
 * started deleting records on upgrade would be a surprise nobody asked for. Turning it on is a
 * deliberate act.
 */
export const DEFAULT_TRACK_CACHE_MAX_BYTES = 0;

/**
 * The stored cap, in bytes, or zero for none.
 *
 * Tolerant in the way `resolveTargetLufs` is: anything unreadable answers the default rather than
 * throwing. A settings row nobody can parse must not be able to start deleting audio, and it must
 * not be able to stop the sweep from running either — falling back to "no cap" is the safe direction
 * on both counts, because it only ever means the station keeps more than it was told to.
 *
 * A negative number is the same as none. It is the one value an operator can type that has no
 * meaning at all, and reading it as "cap everything" would empty the cache over a typo.
 */
export function resolveTrackCacheMaxBytes(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TRACK_CACHE_MAX_BYTES;

    return Math.floor(parsed);
}
