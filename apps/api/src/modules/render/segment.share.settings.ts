/**
 * How long the station keeps the copies of its breaks that listeners share.
 *
 * A runtime knob beside the store it governs, read live through `AppConfig` so tonight's sweep uses
 * whatever the operator set this afternoon.
 */

import type { AppConfig } from '@maroonedsoftware/appconfig';
import { numberOr } from '#modules/shared/setting.numbers.js';

/** The `deadair.settings` key. Dot-keyed, like every other setting. */
export const SHARE_COPY_DAYS_KEY = 'render.shareCopyDays';

/** A week from the last time anybody asked for it. Long enough for a break passed around a group, short enough to stay small. */
export const SHARE_COPY_DAYS_DEFAULT = 7;

/** The range the registry declares and the resolver clamps to. */
export const SHARE_COPY_DAYS_MIN = 1;
export const SHARE_COPY_DAYS_MAX = 365;

/**
 * How many days a copy nobody asks for is kept.
 *
 * **Never "keep them all".** Script history reads `0` as keeping everything, because there it is the
 * only record of what was said. These are a cache, every one of them can be made again, and a store
 * anybody signed in can add to must not be able to grow without end, so `0` is clamped to the floor
 * like any other number below it. Unparseable text takes the default.
 */
export function resolveShareCopyDays(config: AppConfig): number {
    const days = Math.floor(numberOr(config, SHARE_COPY_DAYS_KEY, SHARE_COPY_DAYS_DEFAULT));
    return Math.min(SHARE_COPY_DAYS_MAX, Math.max(SHARE_COPY_DAYS_MIN, days));
}
