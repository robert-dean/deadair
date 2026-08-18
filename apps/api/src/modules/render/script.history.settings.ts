/**
 * How long the station keeps what it wrote, and how much of it.
 *
 * Two knobs, deliberately in different groups, because they answer to different things. Retention
 * belongs to the render module beside the segments it describes; capture belongs to the model,
 * because the two columns it fills only ever hold a model's prompt and a model's raw answer.
 *
 * Both are runtime knobs on the settings page rather than constants: the first is a disk-space
 * decision only an operator can make, and the second is a thing they turn ON for an evening of
 * prompt tuning and off again afterwards. Read live through `AppConfig`, so neither needs a
 * restart and neither needs a DI scope.
 */

import type { AppConfig } from '@maroonedsoftware/appconfig';
import { resolveRetentionDays } from '#modules/shared/retention.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';

/** The `deadair.settings` keys. Dot-keyed, like every other setting. */
export const SCRIPT_HISTORY_KEYS = {
    retentionDays: 'render.scriptHistoryDays',
    capture: 'llm.captureWrites',
} as const;

export const SCRIPT_HISTORY_DEFAULTS = {
    /**
     * A season of writing.
     *
     * Long enough that "it started sounding flat a while ago" is still answerable, short enough that
     * a station talking every fourth record does not accumulate forever. A row is a few hundred
     * bytes without the capture columns, so this is a small table at any plausible setting.
     */
    retentionDays: 90,
    capture: false,
} as const;

/**
 * How many days of writing to keep, or `0` for all of it.
 *
 * Its own resolver rather than a raw config read, sharing the registry's default so the two cannot
 * disagree, exactly as `resolveStreamSettings` and `stationRules` do. Anything unparseable, negative
 * or fractional resolves to keeping everything: this number's only use is deciding what to DELETE,
 * so every uncertain reading has to fall the safe way.
 */
export function resolveHistoryRetentionDays(config: AppConfig): number {
    return resolveRetentionDays(config, SCRIPT_HISTORY_KEYS.retentionDays, SCRIPT_HISTORY_DEFAULTS.retentionDays);
}

/** Whether a model's prompt and raw answer are kept alongside the words it produced. */
export function captureWrites(config: AppConfig): boolean {
    return settingIsOn(config, SCRIPT_HISTORY_KEYS.capture, SCRIPT_HISTORY_DEFAULTS.capture);
}
