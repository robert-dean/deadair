/**
 * How long a production is, and how that length is divided into beats.
 *
 * **Arithmetic, never the model's.** The outline supplies content and this supplies shape, and the
 * split is the single most expensive thing v1 learned: asked to decide its own beat count, a model
 * gives one story one beat, so one story in a ten-minute show meant a single beat asked to carry
 * about 1300 spoken words — which no model writes in one call, so the episode came back short and
 * shapeless. The opposite extreme is just as bad: twenty stories in the same show meant twenty
 * 65-word beats, which is headline-reading rather than a programme.
 *
 * This station has already made the same measurement in the small. `DEFAULT_MAX_WORDS` was never
 * what bounded a break — 2 of 137 captured answers reached it and the median came in at 28 words —
 * so what shapes an answer is what it is ASKED for, not the ceiling it is given. A beat is that rule
 * at production scale: size the ask.
 *
 * ## The band, and why a beat count comes from the budget
 *
 * A beat is aimed at {@link TARGET_WORDS} and kept inside {@link MIN_WORDS}–{@link MAX_WORDS},
 * because that is the range a model reliably writes in one call as continuous speech. **The beat
 * count is then whatever the budget divides into**, rather than however many items came in. Items
 * are spread across the beats afterwards, which is the right way round: more items than beats groups
 * neighbours, and more beats than items gives one subject several beats that the outline then takes
 * different angles on.
 */

/** How fast the station is assumed to speak, for turning a duration into a word budget. */
export const WORDS_PER_MINUTE = 160;

/**
 * The band one beat is written in.
 *
 * Not tuning knobs: below the floor a beat is a headline read out, and above the ceiling a model
 * stops before it reaches the end and the beat arrives truncated.
 */
export const MIN_WORDS = 150;
export const TARGET_WORDS = 200;
export const MAX_WORDS = 260;

/**
 * A ceiling on beats, so a feature-length production cannot fan out into hundreds of model calls.
 *
 * It binds before the band does: past this, beats go over {@link MAX_WORDS} rather than multiplying,
 * and {@link expectedWords} is what keeps the check honest about that.
 */
export const MAX_BEATS = 24;

/**
 * The ceiling on what a single beat is JUDGED against, whatever it was asked for.
 *
 * Carried across from v1, where it is the fix for a specific waste: past {@link MAX_BEATS} a
 * feature-length production hands some beat a budget no single completion reaches, and a check that
 * measured "too short" against that number would burn a re-draft on every one of them, chasing a
 * length the model cannot produce. So the floor stops climbing here.
 */
export const MAX_EXPECTED_WORDS = 320;

/** One beat's place and size. */
export interface BeatShape {
    ordinal: number;
    words: number;
}

/** What the whole production is divided into. */
export interface ProductionShape {
    beats: BeatShape[];
}

/**
 * How many words fit in a talk budget at the station's speaking rate.
 *
 * Floored at something sayable, so a production commissioned for a few seconds is a very short
 * production rather than one with a budget of zero.
 */
export function wordBudget(targetMs: number, wordsPerMinute = WORDS_PER_MINUTE): number {
    return Math.max(MIN_WORDS, Math.floor((targetMs / 60_000) * wordsPerMinute));
}

/**
 * How many beats a budget is worth: aim for {@link TARGET_WORDS} each, and never leave the band
 * unless the ceiling forces it.
 *
 * Three numbers rather than one division, because the band has to be respected from both ends: the
 * fewest beats that keep each under the ceiling, the most that keep each over the floor, and the aim
 * in between. The aim is then clamped into that range, so a budget that divides awkwardly lands on
 * whichever end of the band is closer rather than outside it.
 */
export function beatCount(words: number): number {
    const fewest = Math.max(1, Math.ceil(words / MAX_WORDS));
    const most = Math.max(1, Math.floor(words / MIN_WORDS));
    const aim = Math.max(1, Math.round(words / TARGET_WORDS));

    return Math.min(MAX_BEATS, Math.max(fewest, Math.min(most, aim)));
}

/**
 * The shape of a production of this length.
 *
 * The budget is split evenly, with the remainder spread one word at a time across the earliest beats
 * rather than dumped on the last one — which would leave the final beat measurably longer than every
 * other and, at the ceiling, outside the band the check judges it against.
 */
export function planProduction(targetMs: number, wordsPerMinute = WORDS_PER_MINUTE): ProductionShape {
    const words = wordBudget(targetMs, wordsPerMinute);
    const count = beatCount(words);

    const each = Math.floor(words / count);
    const spare = words - each * count;

    return {
        beats: Array.from({ length: count }, (_, ordinal) => ({ ordinal, words: each + (ordinal < spare ? 1 : 0) })),
    };
}

/**
 * What a beat is actually judged against, as against what it was asked for.
 *
 * The two differ only past {@link MAX_BEATS}. See {@link MAX_EXPECTED_WORDS}: measuring "too short"
 * against a number no single completion reaches turns every beat of a feature-length production into
 * a wasted re-draft.
 */
export const expectedWords = (asked: number): number => Math.min(asked, MAX_EXPECTED_WORDS);

/**
 * Spread items across beats, in order, so every item lands in at least one.
 *
 * More items than beats groups neighbours into one beat; more beats than items gives one subject
 * several consecutive beats, which the outline then takes different angles on. Both are ordinary:
 * the beat count answers to the length of the production, and the items answer to whatever the
 * operator handed it.
 */
export function spreadItems<T>(items: readonly T[], beats: number): T[][] {
    if (beats <= 0) return [];
    if (items.length === 0) return Array.from({ length: beats }, () => []);

    return Array.from({ length: beats }, (_, index) => {
        const start = Math.floor((index * items.length) / beats);
        const end = Math.max(start + 1, Math.floor(((index + 1) * items.length) / beats));
        return items.slice(start, Math.min(end, items.length));
    });
}
