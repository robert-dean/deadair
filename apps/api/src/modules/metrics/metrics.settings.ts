/**
 * How long the station keeps its numbers.
 *
 * Two windows, because the table holds two resolutions and they answer different questions. Minute
 * rows are for "what happened this afternoon", and nobody zooms to the minute a month later; hour
 * rows are for "is the audience growing", which is only answerable over months. Keeping the minutes
 * for a year would cost sixty times the rows for a resolution no chart of a year can draw.
 *
 * Runtime knobs rather than constants, like `activity.retentionDays`: disk is the operator's
 * decision, and the table's size depends on how many series their plugins and queues produce.
 */

import type { AppConfig } from '@maroonedsoftware/appconfig';
import { resolveRetentionDays } from '#modules/shared/retention.js';

/** The `deadair.settings` keys. */
export const METRICS_KEYS = {
    minuteRetentionDays: 'metrics.minuteRetentionDays',
    hourRetentionDays: 'metrics.hourRetentionDays',
} as const;

export const METRICS_DEFAULTS = {
    /** A week of minutes: enough to compare this afternoon with the same one last week. */
    minuteRetentionDays: 7,
    /** Thirteen months of hours, so this month can be read against the same month last year. */
    hourRetentionDays: 400,
} as const;

/** The longest either window may be set to: ten years, which is "keep it" without saying zero. */
export const MAX_METRICS_RETENTION_DAYS = 3650;

/**
 * How many days of minute rows to keep, or `0` for all of them. Every uncertain reading keeps
 * everything, on `resolveRetentionDays`'s rule.
 */
export function resolveMinuteRetentionDays(config: AppConfig): number {
    return resolveRetentionDays(config, METRICS_KEYS.minuteRetentionDays, METRICS_DEFAULTS.minuteRetentionDays);
}

/** How many days of hour rows to keep, or `0` for all of them. */
export function resolveHourRetentionDays(config: AppConfig): number {
    return resolveRetentionDays(config, METRICS_KEYS.hourRetentionDays, METRICS_DEFAULTS.hourRetentionDays);
}
