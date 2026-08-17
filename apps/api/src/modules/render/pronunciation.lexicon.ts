/**
 * How the station says a word, as something an operator owns.
 *
 * The half of speech that no rule can ever get right. `transposeForSpeech` can work out that `1984`
 * is a year and that `feat.` is "featuring", because those are patterns; nothing in a pattern knows
 * that one stylized name is said as the letters, another as a word, and a third as neither. A
 * station whose library has forty such names needs forty facts, and facts belong to the operator.
 *
 * ## The syntax is one thing
 *
 * `written => spoken`, one per line. `#` turns a line off without losing it, blank lines are
 * ignored, and an empty right-hand side means "do not say this at all" — which is the honest reading
 * for a marker that got into a title and is not a word.
 *
 * **The right-hand side is handed to the engine untouched.** The host does not interpret it, exactly
 * as it does not interpret a voice id: an operator whose engine accepts inline phoneme markup can
 * put that there, and one whose engine does not spells the name out. Neither is this file's business.
 *
 * ## Why the defaults are seeds rather than a dictionary
 *
 * {@link DEFAULT_PRONUNCIATIONS} is eight entries and will never be eighty. It exists to show the
 * syntax with cases an operator will recognise, and to make clearing the box restore something
 * rather than nothing — the same bargain `rotation.breakTemplates` makes. A real station's list is
 * its own library's names, which nobody here can guess.
 */

/** The `deadair.settings` key. Dot-keyed, like every other setting. */
export const PRONUNCIATION_KEY = 'render.pronunciations';

/** One thing the station says differently from how it is written. */
export interface Pronunciation {
    /** What appears in a script. Matched case-insensitively. */
    written: string;
    /** What is handed to the engine instead. Empty means the words are dropped. */
    spoken: string;
}

/**
 * The station's own, as a starting point.
 *
 * Every one of them is a case the rules cannot reach: a name whose letters are not its sounds, or a
 * symbol standing in for a letter. Nothing here is a pattern, which is the whole reason this is a
 * list and not code.
 */
export const DEFAULT_PRONUNCIATIONS: readonly Pronunciation[] = [
    { written: 'P!nk', spoken: 'Pink' },
    { written: 'Ke$ha', spoken: 'Kesha' },
    { written: 'deadmau5', spoken: 'dead mouse' },
    { written: '3OH!3', spoken: 'three oh three' },
    { written: 'AC/DC', spoken: 'A C D C' },
    { written: 'CHVRCHES', spoken: 'churches' },
    { written: 'Sade', spoken: 'Shar-day' },
    { written: 'Röyksopp', spoken: 'royk-sop' },
] as const;

/** What separates the two halves of an entry. */
const ARROW = '=>';

/** A line that is a comment, which is how one is turned off without being lost. */
const isComment = (line: string): boolean => line.trimStart().startsWith('#');

/**
 * The entries an operator has set, or the station's own.
 *
 * Empty means the defaults, exactly as every other setting resolves. A malformed line is SKIPPED
 * rather than failing the parse, for the reason `break.templates.ts` gives a template with an
 * unknown placeholder: one bad line must not take the other thirty with it, and the station saying
 * a name plainly is recoverable where the station not speaking is not. {@link malformedEntries}
 * is how a caller says which lines those were.
 *
 * `fallback` exists so a caller can ask for exactly what the operator wrote, defaults and all,
 * without this deciding for it. Nothing passes it today; the seam matches `parseTemplates`.
 */
export function parsePronunciations(raw: string | undefined, fallback: readonly Pronunciation[] = DEFAULT_PRONUNCIATIONS): readonly Pronunciation[] {
    const entries = linesOf(raw).flatMap(line => {
        const entry = entryOf(line);
        return entry === undefined ? [] : [entry];
    });

    return entries.length > 0 ? entries : fallback;
}

/**
 * Every line that is not an entry, for an operator's benefit.
 *
 * A line with no arrow looks from the console exactly like an entry the station has decided not to
 * use, which is the same trap an unknown placeholder is: it wants saying once, quoted, rather than
 * silently ignored.
 */
export function malformedEntries(raw: string | undefined): string[] {
    return linesOf(raw).filter(line => entryOf(line) === undefined);
}

/**
 * Say all of these, in one pass.
 *
 * ONE regular expression over the whole text rather than a replace per entry, and that is a
 * correctness rule rather than a speed one: replacing in sequence lets the output of one entry be
 * matched by the next, so `Sade => Shar-day` followed by an entry for `day` would compound. A single
 * alternation cannot, because every match is taken from the original text.
 *
 * Longest written form first, so an entry for a whole band name wins over an entry for a word inside
 * it. Bounded by "not a letter or digit" on each side rather than `\b`, which is an ASCII rule and
 * would misjudge both `Röyksopp` and `P!nk`.
 */
export function applyPronunciations(text: string, entries: readonly Pronunciation[]): string {
    if (entries.length === 0) return text;

    const usable = entries.filter(entry => entry.written.trim().length > 0);
    if (usable.length === 0) return text;

    const byLongest = [...usable].sort((a, b) => b.written.length - a.written.length);
    const spokenFor = new Map(byLongest.map(entry => [entry.written.toLowerCase(), entry.spoken]));
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${byLongest.map(entry => escapeForRegExp(entry.written)).join('|')})(?![\\p{L}\\p{N}])`, 'giu');

    return text.replace(pattern, match => spokenFor.get(match.toLowerCase()) ?? match);
}

/** One line as an entry, or `undefined` when it is not one. */
function entryOf(line: string): Pronunciation | undefined {
    const at = line.indexOf(ARROW);
    if (at < 0) return undefined;

    const written = line.slice(0, at).trim();
    if (written.length === 0) return undefined;

    return { written, spoken: line.slice(at + ARROW.length).trim() };
}

/** One blob of entries as lines: trimmed, comments dropped, blanks dropped. */
function linesOf(raw: string | undefined): string[] {
    return (raw ?? '')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !isComment(line));
}

/**
 * A written form as a literal, since half of them are punctuation.
 *
 * `-` is deliberately NOT escaped: outside a character class it needs no escaping, and `\-` is a
 * syntax error under the `u` flag the pattern above carries — which would take the whole lexicon out
 * over one hyphenated entry.
 */
const escapeForRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
