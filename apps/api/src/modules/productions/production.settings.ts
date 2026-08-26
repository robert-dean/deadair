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
    targetMinutesMin: 'render.productionMinutesMin',
    targetMinutesMax: 'render.productionMinutesMax',
    dialogueKinds: 'render.dialogueKinds',
    dialogueMinutesMin: 'render.dialogueMinutesMin',
    dialogueMinutesMax: 'render.dialogueMinutesMax',
    gapMs: 'render.productionGapMs',
} as const;

/**
 * How much silence goes between two beats when they are joined, in milliseconds.
 *
 * The one number this whole join exists to make settable. Before it, the pause between two turns of
 * a phone-in was the speech engine's own leading and trailing silence plus whatever the transport
 * added at the boundary — different per voice, per line, and per run, and adjustable by nobody.
 *
 * 200ms is a beat between turns rather than a pause. It is a starting point somebody has to listen
 * to, not a measurement.
 */
export const DEFAULT_GAP_MS = 200;

/**
 * The band that gap may sit in.
 *
 * Zero is legitimate — a station that wants its turns to run straight into each other — and the
 * ceiling is where a beat between turns has become a break in the programme, which is two items in
 * a running order rather than one gap. Mirrors the analyzer's own limit, deliberately: a value past
 * what the joiner will accept is a production that silently airs as beats.
 */
export const MIN_GAP_MS = 0;
export const MAX_GAP_MS = 2000;

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

/**
 * How long a production runs when nobody said, in minutes, as the ends of a RANGE.
 *
 * A range rather than a number, and not only for the phone-in that prompted it: a documentary strand
 * that is always precisely ten minutes is as mechanical as a phone-in that is always precisely
 * three, and it is the one thing about a schedule a listener notices without being able to say why.
 * Centred on the ten this used to be, so nothing about an existing station's programming moves.
 */
export const DEFAULT_TARGET_MINUTES_MIN = 8;
export const DEFAULT_TARGET_MINUTES_MAX = 12;

/**
 * How long a CONVERSATION runs when nobody said, in minutes.
 *
 * Its own range because a phone-in and a documentary are not the same length, and the arithmetic
 * makes the gap wider than it looks: a turn is a fraction of a beat, so ten minutes of dialogue is
 * dozens of turns rather than eight — which is not a long phone-in, it is a different programme.
 *
 * Two to three, which is where a call sits. It used to be a flat three; the lower end came down
 * with the complaint that call-ins ran long, and having a range at all is what stops every one of
 * them being the same programme at a different length.
 *
 * The better long-term shape is a length on the clock band row, since `deadair.clock_bands` is a
 * table now and a band saying its own length would kill this setting. That is the thing to do when a
 * THIRD kind of production appears rather than now.
 */
export const DEFAULT_DIALOGUE_MINUTES_MIN = 2;
export const DEFAULT_DIALOGUE_MINUTES_MAX = 3;

/**
 * The band a production's length may sit in, either end.
 *
 * One minute is where a programme stops being one, and two hours is where a `target_ms` typo becomes
 * a block nothing else can be scheduled around. Shared with the console for the reason every range
 * here is: the resolver CLAMPS, because it reads a row that is already stored, and the console
 * REFUSES, because that is somebody typing one and a clamp there stores a figure they did not ask
 * for and shows it back as though they had.
 */
export const MIN_PRODUCTION_MINUTES = 1;
export const MAX_PRODUCTION_MINUTES = 120;

/**
 * How coarsely a length is picked out of its range.
 *
 * Thirty seconds, because the turn arithmetic quantises anyway — `beatCount` maps a band of word
 * budgets onto the same turn count — so a finer step would produce lengths that come out identical
 * and a coarser one would produce two or three possible programmes. At the dialogue band a
 * thirty-second step moves the turn count by about two, which is audible.
 */
export const LENGTH_STEP_MS = 30_000;

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
 * The silence to put between joined beats, in milliseconds.
 *
 * CLAMPED rather than refused, which is the rule every resolver here follows: this reads a row that
 * is already stored, and a setting that will not load stops the join behind it. The console refuses
 * an out-of-range figure at the point somebody types one.
 *
 * Read as a string and parsed, for {@link stationTargetMs}'s reason: every layer of `AppConfig`
 * holds text, so a stored `250` arrives as `'250'`.
 */
export function stationGapMs(config: AppConfig): number {
    const set = Number(String(config.get(PRODUCTION_KEYS.gapMs, String(DEFAULT_GAP_MS))).trim());
    if (!Number.isFinite(set)) return DEFAULT_GAP_MS;

    return Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, Math.round(set)));
}

/**
 * How long a production of this kind runs, in milliseconds, picked out of the station's range.
 *
 * Kind-aware because a conversation has its own range: without it a `callin` band commissions ten
 * minutes, which the turn arithmetic turns into dozens of turns of a phone call.
 *
 * ## Why a resolver is allowed to be random here, and nowhere else
 *
 * Every other resolver in this tree is pure, and for a good reason: a setting that answers
 * differently on two reads is a station that disagrees with itself. This one is safe because the
 * answer is read ONCE and stored. `stationTargetMs` is called at commission — `ProductionsService`
 * and `ProductionScheduler`, both of which put the result straight into `productions.target_ms` —
 * and every pass afterwards reads the row. Nothing re-derives it, so there is nothing for a second
 * roll to contradict.
 *
 * `random` is a parameter for {@link wordBudget}'s reason one file over: a test that cannot pin the
 * roll is a test of nothing.
 *
 * **Read as a STRING and parsed**, which is not defensiveness: every layer of `AppConfig` holds text,
 * so a stored `20` arrives as `'20'` and `Number.isFinite('20')` is false. This function read the
 * value straight and asked `Number.isFinite` of it for as long as it existed, which meant a station
 * that had ever set the setting silently got the default back. See the `settingIsOn` gotcha in
 * CLAUDE.md, of which this is the numeric half.
 */
export function stationTargetMs(config: AppConfig, kind?: string, random: () => number = Math.random): number {
    const dialogue = kind !== undefined && dialogueKinds(config).has(kind.trim().toLowerCase());

    const low = minutesSetting(
        config,
        dialogue ? PRODUCTION_KEYS.dialogueMinutesMin : PRODUCTION_KEYS.targetMinutesMin,
        dialogue ? DEFAULT_DIALOGUE_MINUTES_MIN : DEFAULT_TARGET_MINUTES_MIN,
    );
    const high = minutesSetting(
        config,
        dialogue ? PRODUCTION_KEYS.dialogueMinutesMax : PRODUCTION_KEYS.targetMinutesMax,
        dialogue ? DEFAULT_DIALOGUE_MINUTES_MAX : DEFAULT_TARGET_MINUTES_MAX,
    );

    // Read as an unordered pair rather than refused, on this file's own rule: a resolver reads a row
    // that is already stored, and a station whose two numbers are the wrong way round should get a
    // range rather than an error. The console refuses the pair at the point somebody types it.
    return pickWithin(Math.min(low, high) * 60_000, Math.max(low, high) * 60_000, random);
}

/**
 * A length out of a range, on a {@link LENGTH_STEP_MS} boundary and never below the floor.
 *
 * Inclusive at both ends — a range of 2 to 3 has to be able to answer three minutes, or the setting
 * says something it does not mean.
 */
function pickWithin(lowMs: number, highMs: number, random: () => number): number {
    const steps = Math.floor((highMs - lowMs) / LENGTH_STEP_MS);
    if (steps <= 0) return lowMs;

    return lowMs + Math.min(steps, Math.floor(random() * (steps + 1))) * LENGTH_STEP_MS;
}

/** One end of a length range, in whole minutes, clamped into the band a programme can be. */
function minutesSetting(config: AppConfig, key: string, fallback: number): number {
    const minutes = Number(String(config.get(key, String(fallback))).trim());
    const set = Number.isFinite(minutes) && minutes > 0 ? minutes : fallback;

    return Math.min(MAX_PRODUCTION_MINUTES, Math.max(MIN_PRODUCTION_MINUTES, set));
}
