/**
 * The archive: what the station keeps of what it aired, and for how long.
 *
 * `radio.liq` writes the files (see "The archive" in `stream/README.md`); this app reads them back,
 * serves them and sweeps them. Kept beside the stream settings rather than in them because only one
 * of these reaches Liquidsoap, and the retention window is the app's alone.
 */

import { join } from 'node:path';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import { resolveRetentionDays } from '#modules/shared/retention.js';

/** The `deadair.settings` keys. Dot-keyed, like every other setting. */
export const ARCHIVE_KEYS = {
    /** How many days a finished recording is kept, measured from when it ended. `0` keeps them all. */
    retentionDays: 'stream.archiveDays',
} as const;

export const ARCHIVE_DEFAULTS = {
    // Two weeks: long enough to get round to cutting clips from a weekend's shows, short enough that
    // a station archiving around the clock (about 2 GB a day) does not quietly fill its disk.
    retentionDays: 14,
} as const;

/**
 * Where the archive is, as this app sees it.
 *
 * The same arrangement as HLS: Liquidsoap writes to the volume at its own mount point
 * (`ARCHIVE_LIQUIDSOAP_DIR`) and this app reads the same files at this one (`ARCHIVE_DIR`).
 */
export function defaultArchiveDir(): string {
    return join(process.cwd(), '..', '..', '.docvol', 'streamarchive');
}

/**
 * How many days a finished recording is kept, or `0` for all of them.
 *
 * Zero keeps everything here, unlike the share copies, because a recording is not a cache: nothing
 * can make it again. What bounds the disk is the operator choosing a number, which the default does.
 */
export function resolveArchiveDays(config: AppConfig): number {
    return resolveRetentionDays(config, ARCHIVE_KEYS.retentionDays, ARCHIVE_DEFAULTS.retentionDays);
}
