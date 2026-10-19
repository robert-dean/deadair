/**
 * Whether a script said the one fact it was handed.
 *
 * For the record only: it decides nothing about the break, which has aired or not by the time anybody
 * reads the answer. It exists because `trivia: always` ASKS for a fact rather than offering it, and
 * whether a model does what it is asked is the measurement that decides whether a refusal is worth
 * building. Never asked of the model, for `weather.figures.ts`' reason: a model asked to report what
 * it just did is a check that approves its own work.
 *
 * A fact counts as said when the script carries one of its DISTINCTIVE words: a capitalised word that
 * is not the first of the sentence and not part of either record's title or artist (a link names the
 * records anyway, so a fact about Nick Drake is not evidenced by the words "Nick Drake"), or a number
 * written in digits. A paraphrase keeps names and figures and changes everything around them, which is
 * why those and nothing else are what is looked for.
 *
 * `undefined` when the fact has no such word, because then this cannot tell and a guess either way
 * would be a number about the guess. What it cannot catch is a figure the script spelt out ("nineteen
 * seventy-two" for 1972): it answers no there, which undercounts rather than overcounts what was said.
 */
export function mentionsFact(script: string, fact: string, recordNames: readonly string[]): boolean | undefined {
    const known = new Set(recordNames.flatMap(name => wordsOf(name)).map(word => word.toLowerCase()));
    const distinctive = distinctiveWords(fact).filter(word => !known.has(word.toLowerCase()));
    if (distinctive.length === 0) return undefined;

    const said = new Set(wordsOf(script).map(word => word.toLowerCase()));
    return distinctive.some(word => said.has(word.toLowerCase()));
}

/** Words with their letters and digits, apostrophes kept inside a word and dropped around it. */
const wordsOf = (text: string): string[] => text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];

/** The fact's names and figures: capitalised words not opening a sentence, and numbers. */
function distinctiveWords(fact: string): string[] {
    const found: string[] = [];
    for (const sentence of fact.split(/(?<=[.!?])\s+/)) {
        wordsOf(sentence).forEach((word, index) => {
            if (/^\p{N}+$/u.test(word)) found.push(word);
            else if (index > 0 && word.length > 1 && /^\p{Lu}/u.test(word)) found.push(word);
        });
    }
    return found;
}
