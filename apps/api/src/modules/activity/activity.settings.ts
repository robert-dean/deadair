/**
 * How long the station keeps the record of what it has been doing.
 *
 * A runtime knob rather than a constant, for the reason `render.scriptHistoryDays` is one: it is a
 * disk-space decision only an operator can make, and the right answer depends on how talkative the
 * station is and how long they expect to be asked about a night they have forgotten.
 *
 * It covers `station_events` and nothing else, deliberately. `play_history` has its own 120-day
 * sweep beside the rotation rules that read it, and `segment_events` cascades from the segment it
 * describes; a second policy over either would be a second thing deciding their lifetime, and the
 * feed is a reader of those tables rather than their owner.
 */

import type { AppConfig } from '@maroonedsoftware/appconfig';
import { resolveRetentionDays } from '#modules/shared/retention.js';

/** The `deadair.settings` key. Dot-keyed, like every other setting. */
export const ACTIVITY_KEYS = {
    retentionDays: 'activity.retentionDays',
} as const;

export const ACTIVITY_DEFAULTS = {
    /**
     * A season, matching `render.scriptHistoryDays`.
     *
     * The two answer the same kind of question — "what was the station doing when this started
     * sounding wrong" — and a feed that outlived the scripts it points at, or the other way round,
     * would leave one half of that answer missing for no reason an operator could guess.
     *
     * A row is a couple of hundred bytes and producers write on edges rather than on polls, so this
     * is a small table at any plausible setting.
     */
    retentionDays: 90,
} as const;

/**
 * How many days of activity to keep, or `0` for all of it.
 *
 * Its own resolver rather than a raw config read, sharing the registry's default so the two cannot
 * disagree. Anything unparseable, negative or fractional resolves to keeping everything: this
 * number's only use is deciding what to DELETE, so every uncertain reading has to fall the safe way.
 */
export function resolveActivityRetentionDays(config: AppConfig): number {
    return resolveRetentionDays(config, ACTIVITY_KEYS.retentionDays, ACTIVITY_DEFAULTS.retentionDays);
}
