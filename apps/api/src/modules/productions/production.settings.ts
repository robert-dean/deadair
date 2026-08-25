/**
 * What an operator decides about productions, before they ask for one.
 *
 * Few knobs, deliberately. Everything else about a production is either its own (the brief, the
 * length, who presents it) or arithmetic the station does not ask anybody about.
 *
 * This said "two knobs and no more" while there were two. The third is which KINDS of production
 * have somebody phone in, and it earns its place for the reason `render.productionKinds` does one
 * file over: `segments.kind` is free text by design, so which of those kinds is a conversation
 * cannot be a constant without a code change per station.
 */

import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { WritingMode } from './production.js';
import { isWritingMode } from './production.passes.js';

/** The `deadair.settings` keys. In `render`, beside the other things the station makes. */
export const PRODUCTION_KEYS = {
    writingMode: 'render.productionWritingMode',
    targetMinutes: 'render.productionMinutes',
    dialogueKinds: 'render.dialogueKinds',
    dialogueMinutes: 'render.dialogueMinutes',
} as const;

/**
 * The kinds that put somebody on the phone, unless the station says otherwise.
 *
 * `callin` alone: a podcast is one voice thinking out loud and a phone-in is two people talking, and
 * a station that wants callers in its podcast says so here rather than getting them by default in a
 * form nobody designed for them.
 */
export const DEFAULT_DIALOGUE_KINDS = 'callin';

/**
 * The kinds this station makes as conversations, as a set.
 *
 * Parsed exactly like `productionKinds`, and separate from it on purpose: whether a kind is a
 * PRODUCTION and whether it is a DIALOGUE are two questions, and a station wanting a documentary
 * strand with callers in it should not have to choose between them.
 */
export function dialogueKinds(config: AppConfig): Set<string> {
    return new Set(
        config
            .get(PRODUCTION_KEYS.dialogueKinds, DEFAULT_DIALOGUE_KINDS)
            .split(',')
            .map(kind => kind.trim().toLowerCase())
            .filter(kind => kind.length > 0),
    );
}

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
 * How long a CONVERSATION runs when nobody said, in minutes.
 *
 * Its own number because a phone-in and a documentary are not the same length, and the arithmetic
 * makes the gap wider than it looks: a turn is a third of a beat, so ten minutes of dialogue is
 * twenty-three turns rather than eight — which is not a long phone-in, it is a different programme.
 * Three minutes is seven turns, which is a call.
 *
 * The better long-term shape is a length on the clock band row, since `deadair.clock_bands` is a
 * table now and a band saying its own length would kill this setting. That is the thing to do when a
 * THIRD kind of production appears rather than now.
 */
export const DEFAULT_DIALOGUE_MINUTES = 3;

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

/**
 * The station's default length for a production of this kind, in milliseconds.
 *
 * Kind-aware because a conversation has its own default: without it a `callin` band commissions ten
 * minutes, which the turn arithmetic turns into twenty-three turns of a phone call.
 *
 * **Read as a STRING and parsed**, which is not defensiveness: every layer of `AppConfig` holds text,
 * so a stored `20` arrives as `'20'` and `Number.isFinite('20')` is false. This function read the
 * value straight and asked `Number.isFinite` of it for as long as it existed, which meant a station
 * that had ever set the setting silently got the default back. See the `settingIsOn` gotcha in
 * CLAUDE.md, of which this is the numeric half.
 */
export function stationTargetMs(config: AppConfig, kind?: string): number {
    const dialogue = kind !== undefined && dialogueKinds(config).has(kind.trim().toLowerCase());
    const key = dialogue ? PRODUCTION_KEYS.dialogueMinutes : PRODUCTION_KEYS.targetMinutes;
    const fallback = dialogue ? DEFAULT_DIALOGUE_MINUTES : DEFAULT_TARGET_MINUTES;

    const minutes = Number(String(config.get(key, String(fallback))).trim());
    return Math.max(1, Number.isFinite(minutes) && minutes > 0 ? minutes : fallback) * 60_000;
}
