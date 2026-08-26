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
 *
 * ## There are TWO bands, because a turn is not a beat
 *
 * The band above is a MONOLOGUE band and its floor is argued as "below 150 a beat is a headline read
 * out" — which is true of somebody talking uninterrupted and false of somebody answering a question.
 * A conversational turn is thirty to a hundred words; at 150 every turn is a speech, and a phone-in
 * written that way is two people reading statements at each other.
 *
 * So {@link TURN_BAND} exists beside it and a production is planned in whichever one its CAST calls
 * for. Nothing else about the arithmetic changes: the count still comes from the budget, the
 * remainder is still spread across the earliest ones, and the model still decides none of it.
 *
 * The one extra rule a dialogue has is that its turn count is kept ODD. The format is that the host
 * opens and the host closes (`production.cast.ts`), and an even count makes those two rules collide
 * on the last turn — so the shape is decided here, where every other question about shape is
 * decided, rather than papered over where the speakers are assigned.
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

/** A band, as the three numbers every part of this file works from. */
export interface WordBand {
    min: number;
    target: number;
    max: number;
}

/** What somebody talking uninterrupted is written in. The station's original and only band. */
export const MONOLOGUE_BAND: WordBand = { min: MIN_WORDS, target: TARGET_WORDS, max: MAX_WORDS };

/**
 * What one turn of a conversation is written in.
 *
 * Shorter than a beat by design and by a long way. The ceiling matters more than the floor: a turn
 * that runs long does not read as a generous answer, it reads as somebody who cannot be interrupted.
 *
 * ## Measured, and the first numbers were far too generous
 *
 * This was `{ 40, 70, 110 }`, which turned a three-minute call into seven turns of about seventy
 * words — and the model hit that budget exactly, at 58 to 78 words across every turn of every
 * phone-in the station made. Seventy words is twenty-six seconds of uninterrupted speech. Seven of
 * those, alternating, is not a conversation: it is two people reading paragraphs at each other, and
 * the operator's complaint about call-ins running long was really a complaint about this.
 *
 * Thirty words is about eleven seconds, which is an answer somebody gives on the phone. The floor at
 * fifteen is where the HOST's turns live once the weights below are applied — "right, so what
 * happened?" is a real turn and is eight words — and the ceiling at sixty is a caller with something
 * to say, still short enough that the host coming back does not feel like an interruption.
 */
export const TURN_BAND: WordBand = { min: 15, target: 30, max: 60 };

/**
 * How a turn's share of the budget differs by who is taking it.
 *
 * The other half of the same failure. `planProduction` divided the budget EVENLY, so the host's
 * "so what happened?" was funded identically to the caller's story — which is not how a phone-in
 * works in either direction: the host asks and hands over, and the caller answers.
 *
 * Multipliers rather than word counts, so they hold at any programme length and the budget stays the
 * operator's. At the shipped dialogue length that is a host asking in about twenty words and a
 * caller answering in about forty.
 *
 * They do not need to sum to anything: {@link planProduction} normalises them against the budget.
 */
export const HOST_TURN_WEIGHT = 0.7;
export const CALLER_TURN_WEIGHT = 1.35;

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
    /**
     * Who says it, as an index into `productions.casting`.
     *
     * Absent for a production with no cast, which is every one the station made before callers: the
     * presenter says all of it, and the beat prompt falls back to whoever is presenting.
     */
    speaker?: number;
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
export function wordBudget(targetMs: number, wordsPerMinute = WORDS_PER_MINUTE, band: WordBand = MONOLOGUE_BAND): number {
    return Math.max(band.min, Math.floor((targetMs / 60_000) * wordsPerMinute));
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
export function beatCount(words: number, band: WordBand = MONOLOGUE_BAND): number {
    const fewest = Math.max(1, Math.ceil(words / band.max));
    const most = Math.max(1, Math.floor(words / band.min));
    const aim = Math.max(1, Math.round(words / band.target));

    return Math.min(MAX_BEATS, Math.max(fewest, Math.min(most, aim)));
}

/** What a production is being planned as. */
export interface PlanOptions {
    /**
     * Somebody is on the phone, so this is turns rather than beats.
     *
     * Derived from the CAST rather than passed around as a mode: a production with a caller in it is
     * a dialogue, and one without is not. See `production.cast.ts`.
     */
    dialogue?: boolean;
    /** Who speaks each turn, as indexes into the cast. Shorter than the plan is padded with the first. */
    speakers?: readonly number[];
    /**
     * What each turn's share of the budget is worth, parallel to {@link speakers}.
     *
     * Numbers rather than roles, so this file stays pure arithmetic and learns nothing about who is
     * on the programme — `production.cast.ts` is where role knowledge lives and `turnWeights` is
     * what builds this. Absent, or shorter than the plan, falls back to an even split, which is what
     * every production before callers got and is right for a monologue.
     */
    weights?: readonly number[];
    wordsPerMinute?: number;
}

/**
 * The shape of a production of this length.
 *
 * The budget is split evenly, with the remainder spread one word at a time across the earliest beats
 * rather than dumped on the last one — which would leave the final beat measurably longer than every
 * other and, at the ceiling, outside the band the check judges it against.
 *
 * A dialogue is planned in {@link TURN_BAND} and its count is forced ODD, which is what lets the host
 * both open and close without two of its turns landing next to each other.
 */
export function planProduction(targetMs: number, options: PlanOptions = {}): ProductionShape {
    const band = options.dialogue === true ? TURN_BAND : MONOLOGUE_BAND;
    const words = wordBudget(targetMs, options.wordsPerMinute ?? WORDS_PER_MINUTE, band);
    const count = options.dialogue === true ? oddly(beatCount(words, band)) : beatCount(words, band);

    const shares = divide(words, count, options.weights);

    return {
        beats: Array.from({ length: count }, (_, ordinal) => ({
            ordinal,
            words: shares[ordinal]!,
            ...(options.speakers === undefined ? {} : { speaker: options.speakers[ordinal] ?? 0 }),
        })),
    };
}

/**
 * A budget split across beats, weighted where the caller said how.
 *
 * The remainder is spread one word at a time across the EARLIEST beats rather than dumped on the
 * last one, which would leave the final beat measurably longer than every other and, at the ceiling,
 * outside the band the check judges it against. That was true of the even split and stays true here.
 *
 * Weights are normalised against the budget rather than taken as counts, so the operator's chosen
 * length is what is divided up however the multipliers are tuned. Each share is floored at one word,
 * since a beat of nothing is a beat nobody can write.
 */
function divide(words: number, count: number, weights: readonly number[] | undefined): number[] {
    // No weights, or a list that does not cover the plan, is an even split — which is every
    // production made before callers existed, and is right for one voice.
    const usable = weights !== undefined && weights.length >= count && weights.every(weight => weight > 0);
    if (!usable) {
        const each = Math.floor(words / count);
        const spare = words - each * count;
        return Array.from({ length: count }, (_, ordinal) => Math.max(1, each + (ordinal < spare ? 1 : 0)));
    }

    const total = weights.slice(0, count).reduce((sum, weight) => sum + weight, 0);
    const shares = Array.from({ length: count }, (_, ordinal) => Math.max(1, Math.floor((words * weights[ordinal]!) / total)));

    let spare = words - shares.reduce((sum, share) => sum + share, 0);
    for (let ordinal = 0; spare > 0; ordinal = (ordinal + 1) % count, spare--) shares[ordinal]! += 1;

    return shares;
}

/**
 * How many TURNS a production of this length would have if somebody rang in.
 *
 * Its own name because it is asked before anybody has been cast, which is the one question in this
 * file that is not about the production it is planning: how many callers are worth casting depends
 * on how many turns there would be, and how many turns there are depends on whether anybody was
 * cast. This is the estimate that breaks the ring, and it must be taken in the DIALOGUE band —
 * measured on the first live run of this, a three-minute call-in estimated as 2 monologue beats,
 * which is below the floor for casting anybody, so a phone-in was made with nobody on the phone.
 */
export const turnsFor = (targetMs: number, wordsPerMinute = WORDS_PER_MINUTE): number =>
    planProduction(targetMs, { dialogue: true, wordsPerMinute }).beats.length;

/**
 * The nearest odd count at or below this one, floored at one.
 *
 * DOWN rather than up, so a dialogue never runs past the length it was commissioned for: the budget
 * is a duration somebody chose, and one turn short of it is a shorter programme where one turn over
 * is a slot that overruns.
 */
const oddly = (count: number): number => (count % 2 === 1 ? count : Math.max(1, count - 1));

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
