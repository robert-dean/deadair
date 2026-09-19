import type { AppConfig } from '@maroonedsoftware/appconfig';
import { settingIsOn } from '#modules/shared/setting.flags.js';

/**
 * Whether the hourly catalog walk runs this hour.
 *
 * ## Why the cron stays hourly
 *
 * `JobMappings` is read once, at setup, and pg-boss keeps the schedule it was given. Making the
 * CRON a setting would mean rewriting that schedule on every settings reload, which nothing else in
 * the station does. So the cron fires every hour as it always has, and a run that is not due
 * returns before it reaches a provider. A skipped hour costs one log line.
 *
 * ## Why "due" keeps no state
 *
 * Nothing records when the last walk ran, and nothing has to: the cron fires on the hour, so a run
 * is due when the hour it fires in is a multiple of the interval, counted from the epoch in UTC.
 * That survives a restart, needs no table, and a retry of a failed run arrives inside the same hour
 * and is still due. The cost is that an interval that does not divide 24 drifts against the day
 * (every 5 hours is 00:00, 05:00, ... 20:00, then 01:00 the next day), which is still every 5 hours.
 *
 * **This judges the SCHEDULED run only.** A walk somebody sent (an operator's refresh, a plugin's
 * settings saved) always runs; turning the automatic walk off must not also turn off the button.
 */

/** The `deadair.settings` keys. Dot-keyed, like every other setting. */
export const CATALOG_SYNC_KEYS = {
    auto: 'catalog.autoSync',
    everyHours: 'catalog.syncEveryHours',
} as const;

export const CATALOG_SYNC_DEFAULTS = {
    /** On, because a station that stopped noticing new records by default would look broken. */
    auto: true,
    /** Every hour, which is what the cron has always done. */
    everyHours: 1,
} as const;

/** A day. Longer than that and the library an operator sees is not the one they have. */
export const MAX_SYNC_EVERY_HOURS = 24;

const HOUR_MS = 3_600_000;

/**
 * The interval, clamped to 1 to {@link MAX_SYNC_EVERY_HOURS}. Clamps rather than refuses, on the
 * resolver rule in `apps/api/CLAUDE.md`: this reads a row that is already stored.
 */
export function resolveSyncEveryHours(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) return CATALOG_SYNC_DEFAULTS.everyHours;

    return Math.min(MAX_SYNC_EVERY_HOURS, Math.max(1, Math.floor(parsed)));
}

/**
 * Whether the scheduled walk should run at `now`.
 *
 * @param config - Read per call, so an operator's edit applies from the next hour.
 * @param now - A parameter rather than read here, so the rule can be tested at any hour.
 */
export function scheduledSyncIsDue(config: AppConfig, now: Date): boolean {
    if (!settingIsOn(config, CATALOG_SYNC_KEYS.auto, CATALOG_SYNC_DEFAULTS.auto)) return false;

    const everyHours = resolveSyncEveryHours(config.get(CATALOG_SYNC_KEYS.everyHours));
    return Math.floor(now.getTime() / HOUR_MS) % everyHours === 0;
}
