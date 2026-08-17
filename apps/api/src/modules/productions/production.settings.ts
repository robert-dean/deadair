/**
 * What an operator decides about productions, before they ask for one.
 *
 * Two knobs and no more, deliberately. Everything else about a production is either its own (the
 * brief, the length, who presents it) or arithmetic the station does not ask anybody about.
 */

import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { WritingMode } from './production.js';
import { isWritingMode } from './production.passes.js';

/** The `deadair.settings` keys. In `render`, beside the other things the station makes. */
export const PRODUCTION_KEYS = {
    writingMode: 'render.productionWritingMode',
    targetMinutes: 'render.productionMinutes',
} as const;

/**
 * How many passes a production gets when nobody said.
 *
 * `outlined` rather than `quick`, because the outline pass is what makes something a programme
 * rather than a sequence of beats — and rather than `polished`, because the check pass costs another
 * model call per beat that failed something, and on a self-hosted model that is wall-clock an
 * operator should opt into rather than inherit.
 */
export const DEFAULT_WRITING_MODE: WritingMode = 'outlined';

/** How long a production runs when nobody said, in minutes. */
export const DEFAULT_TARGET_MINUTES = 10;

/**
 * The station's default writing mode, or the fallback.
 *
 * A value nothing recognises falls back rather than throwing, for the reason every resolver here
 * does: a setting typed wrong by hand must cost the station its preference, never its ability to
 * make anything.
 */
export function stationWritingMode(config: AppConfig): WritingMode {
    const set = config.get(PRODUCTION_KEYS.writingMode, DEFAULT_WRITING_MODE as string).trim();
    return isWritingMode(set) ? set : DEFAULT_WRITING_MODE;
}

/** The station's default length, in milliseconds. Floored at a minute, since anything less is not a production. */
export function stationTargetMs(config: AppConfig): number {
    const minutes = config.get(PRODUCTION_KEYS.targetMinutes, DEFAULT_TARGET_MINUTES);
    return Math.max(1, Number.isFinite(minutes) ? minutes : DEFAULT_TARGET_MINUTES) * 60_000;
}
