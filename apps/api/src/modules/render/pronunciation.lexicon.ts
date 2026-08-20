/**
 * How the station says a word: the matching half.
 *
 * The half of speech that no rule can ever get right. `transposeForSpeech` can work out that `1984`
 * is a year and that `feat.` is "featuring", because those are patterns; nothing in a pattern knows
 * that one stylized name is said as the letters, another as a word, and a third as neither. A
 * station whose library has forty such names needs forty facts, and a fact needs a source.
 *
 * Which is why the entries themselves are rows in `deadair.pronunciations` rather than lines in a
 * setting: an entry the station mined out of an article carries the article and the sentence, and
 * can be turned down in a way that outlives the next pass. See the migration, and
 * {@link PronunciationRepository}. What stays here is the matcher, which never cared where an entry
 * came from.
 *
 * **`spoken` is handed to the engine untouched.** The host does not interpret it, exactly as it does
 * not interpret a voice id: an operator whose engine accepts inline phoneme markup can put that
 * there, and one whose engine does not spells the name out. Neither is this file's business.
 *
 * ## Why the defaults are seeds rather than a dictionary
 *
 * {@link DEFAULT_PRONUNCIATIONS} is eight entries and will never be eighty. It exists so a station
 * starts with cases an operator will recognise rather than with an empty table — the same bargain
 * `rotation.breakTemplates` makes. A real station's list is its own library's names, which nobody
 * here can guess, and increasingly the articles answer for themselves.
 */

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

/**
 * A written form as a literal, since half of them are punctuation.
 *
 * `-` is deliberately NOT escaped: outside a character class it needs no escaping, and `\-` is a
 * syntax error under the `u` flag the pattern above carries — which would take the whole lexicon out
 * over one hyphenated entry.
 */
const escapeForRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
