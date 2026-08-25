import type { AppConfig } from '@maroonedsoftware/appconfig';
import { numberOr } from '#modules/shared/setting.numbers.js';
import { DEFAULT_MAX_WORDS } from './break.prompt.js';

/**
 * How long the station lets itself talk, as something an operator sets.
 *
 * Both ceilings were constants: `DEFAULT_MAX_WORDS` for a link between records, and a literal in the
 * story writer beside it. Forty words is a measured answer to what a talk break should be — 2 of 137
 * captured answers ever reached it and the median came in at 28 — but it is an answer about THIS
 * station's taste, and the one thing an operator cannot express without it is a station that talks
 * more than deadair's author wanted his to.
 *
 * ## The floor is what makes it safe to expose
 *
 * A ceiling is not a target, so raising one costs nothing: the model stops where it stops. LOWERING
 * one is where the damage is, because `readAnswer` CUTS at the last whole sentence that fits and
 * declines what cannot be cut at one — so a ceiling of three words is not a terse station, it is a
 * station whose every model break falls to the phrasings with nothing on any page saying why. Hence
 * {@link MIN_BREAK_WORDS} and {@link MIN_STORY_WORDS}, and hence the registry declaring them: a
 * number typed into the console is REFUSED out of range where a stored row is CLAMPED, which is the
 * split `serializeSetting` and every resolver here already make.
 *
 * A character's own `latitude` still composes on top, through `maxWordsFor`'s `Math.max`: a rung is
 * a floor under the station's ceiling rather than a correction to it, so an operator who raises this
 * past 100 has raised it for the unleashed character too.
 */
export const BREAK_WORD_KEYS = {
    /** The ordinary link between two records. See {@link resolveBreakWords}. */
    talk: 'rotation.breakWords',
    /** A `story` break, which is a different kind of thing. See {@link resolveStoryWords}. */
    story: 'rotation.storyWords',
} as const;

/**
 * The narrowest a talk break may be made.
 *
 * Twenty, which is about eight seconds spoken and is roughly the shortest thing that can name a
 * record and say one thing about it — the two halves `TALK_BREAK_SHAPE.rules` asks for and
 * `mustNameRecord` refuses over. Below it the station would be declining its own model for obeying
 * a rule it was given.
 */
export const MIN_BREAK_WORDS = 20;

/**
 * The widest.
 *
 * Two hundred is a minute and a quarter of talking between two records, which is well past anything
 * this station would write and is the point: the ceiling is not the instruction, so the cost of a
 * generous maximum is nothing and the cost of a stingy one is an operator who cannot have the
 * station they want.
 */
export const MAX_BREAK_WORDS = 200;

/**
 * The default length of a told story, and the floor and ceiling around it.
 *
 * A hundred and twenty words is about forty-five seconds, which is an anecdote rather than a link —
 * that difference is the whole reason the `story` kind exists rather than stories simply riding the
 * talk break. The floor is higher than a talk break's for the same reason: a story cut to twenty
 * words is not a short story, it is an opening clause.
 */
export const DEFAULT_STORY_WORDS = 120;

export const MIN_STORY_WORDS = 40;

export const MAX_STORY_WORDS = 400;

/**
 * The talk break's ceiling, in words.
 *
 * CLAMPED rather than refused, which is the rule every resolver in this codebase follows and the
 * console's own opposite: this is reading a row that is already stored, and a setting that refused
 * to load would stop the writer behind it. Read through {@link numberOr} rather than
 * `config.get(key, 40)`, because every layer of `AppConfig` holds strings and the overload widens
 * its return from the DEFAULT — so a set value arrives as text while TypeScript reports a number.
 */
export const resolveBreakWords = (config: AppConfig): number =>
    clamp(numberOr(config, BREAK_WORD_KEYS.talk, DEFAULT_MAX_WORDS), MIN_BREAK_WORDS, MAX_BREAK_WORDS);

/** A story break's ceiling, in words. See {@link resolveBreakWords} for why it clamps. */
export const resolveStoryWords = (config: AppConfig): number =>
    clamp(numberOr(config, BREAK_WORD_KEYS.story, DEFAULT_STORY_WORDS), MIN_STORY_WORDS, MAX_STORY_WORDS);

/** Whole words, and inside the bounds. A fractional ceiling is a stored row nobody meant to type. */
const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, Math.round(value)));
