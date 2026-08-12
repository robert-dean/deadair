/**
 * Whether the station keeps a copy of the records it plays.
 *
 * A runtime knob, so it lives in `deadair.settings` rather than the environment: env is for what the
 * app needs before a database exists, and this is a decision an operator changes from the console.
 * The DIRECTORY the copies go in is the other kind and stays `TRACKS_DIR`, beside `ART_DIR`.
 *
 * Off means the station neither serves from the cache nor fills it, which makes this the way to
 * A/B a suspected bad cached file without deleting anything: the files stay where they are and are
 * picked up again when it goes back on. It does not delete a thing, because throwing away an
 * operator's gigabytes is not what a toggle should do.
 *
 * Per install, like `playout.airMode` beside it, and it moves onto the station row if the deferred
 * multi-station work lands.
 */

import type { AppConfig } from '@maroonedsoftware/appconfig';

/** The `deadair.settings` key. Dot-keyed, like every other setting. */
export const TRACK_CACHE_KEY = 'playout.trackCache';

/**
 * On, for a station that has never said otherwise.
 *
 * The cache is the difference between a download per play forever and one download per record, and
 * on a rate-limited provider account that is also the difference between a station that stays on air
 * and one that skips items. An install has to get that without opting in.
 */
export const DEFAULT_TRACK_CACHE = true;

/**
 * Whether to use the cache, from whatever the setting says.
 *
 * Read per call off the live `AppConfig` rather than captured at construction, because the config IS
 * a live view of `deadair.settings` and the callers are singletons: an operator's change has to take
 * on the next boundary rather than the next restart.
 *
 * Only an explicit off turns it off: an unset key — every install until someone decides otherwise —
 * gets {@link DEFAULT_TRACK_CACHE}, and so does anything unrecognised. Deliberately not
 * validate-and-throw, because this is read on the hand-over path and a station that refused to hand
 * over an item over a settings row would be a worse failure than the one it was guarding against.
 *
 * The spellings are generous for the same reason `resolveHistoryRetentionDays` accepts a number that
 * arrived as a string: the console writes `false`, and an operator turning this off from psql at two
 * in the morning may well write `off` or `0`.
 */
export function trackCacheEnabled(config: AppConfig): boolean {
    const raw = config.get(TRACK_CACHE_KEY, '');
    if (typeof raw === 'boolean') return raw;

    const value = String(raw).trim().toLowerCase();
    if (value === '') return DEFAULT_TRACK_CACHE;

    return !['false', 'off', 'no', '0'].includes(value);
}
