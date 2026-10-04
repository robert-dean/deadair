import type { LyricMood, MoodDistribution } from '#modules/lyrics/lyric.moods.js';

/**
 * Leaning the draw toward a broadcast's mood, without ever narrowing it.
 *
 * A comparable implementation measured how far a mood read off lyrics can be trusted, against a few
 * hundred records labelled by hand: picking records by it was right about half the time, against a
 * third for picking at random. Better than nothing, and nowhere near good enough to keep a record off
 * the air on its say-so. So a record judged to be in the mood is made MORE LIKELY, by the same factor a
 * like is, and every other record keeps exactly the chance it had: a mismatch, an unjudged record and a
 * record judged and not placed are all weighted alike. Smart shuffle's rule, the other way up: never
 * zero, never a filter.
 *
 * Read by the floor (`CatalogSetGenerator`) and nothing else, for the period's reason: a share the
 * model already stored is a number, and the floor reads numbers and never prose.
 */

/**
 * The share of its weight a record has to give the mood to count as in it.
 *
 * Not fitted, and that is said plainly. A comparable implementation fitted a threshold per mood
 * against hand labels, precision first, and the values it found are specific to its own model's
 * distributions; this station's model answers on a different scale. A third is "a real part of the
 * record's feeling" on seven moods that sum to one, and it should be re-fitted the day somebody labels
 * records here to fit it against.
 */
export const MOOD_FIT_SHARE = 0.35;

/** How much more likely a record in the mood is to be drawn: the same factor a like gets in `weightOf`. */
export const MOOD_BOOST = 2;

/** Whether a judged record is in the mood a broadcast leans into. */
export function moodFits(moods: MoodDistribution | undefined, mood: LyricMood): boolean {
    return moods !== undefined && moods[mood] >= MOOD_FIT_SHARE;
}
