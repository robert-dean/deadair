/**
 * Somebody else's markup as something a person could be read aloud.
 *
 * Lifted out of `feed.parse.ts` when `article.parse.ts` needed the same two
 * steps, and shared rather than copied for the reason `match.text.ts` gives
 * about its own two: a difference between the copies would have one reader
 * hand a model `&amp;` while the other did not, and nobody would notice until
 * a voice said it on air.
 *
 * Neither function knows anything about feeds or articles. What is here is the
 * part that is true of any publisher's text: tags are not words, entities are
 * not punctuation, and a paragraph's worth of whitespace is one space.
 */

/**
 * The XML five, plus the typography a publisher actually writes, plus numeric
 * escapes.
 *
 * Still not the whole HTML entity table, and deliberately: a named entity this
 * does not know is left exactly as it was, which reads as the publisher's own
 * text rather than as a hole. What earns a row here is what turns up in prose —
 * quotes, dashes, an ellipsis — because those are the ones a voice would
 * otherwise read out as "and r s q u o".
 */
const NAMED_ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ndash: '–',
    mdash: '—',
    hellip: '…',
    lsquo: '‘',
    rsquo: '’',
    ldquo: '“',
    rdquo: '”',
};

export function decodeEntities(value: string): string {
    return value.replace(/&(#x?[0-9a-f]+|\w+);/gi, (whole, body: string) => {
        if (body.startsWith('#')) {
            const code = body[1]?.toLowerCase() === 'x' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
            return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
        }

        return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
    });
}

/**
 * Markup as plain text, capped.
 *
 * Tags out, entities decoded, whitespace collapsed, length bounded.
 *
 * Entities are decoded AFTER the tags come out, and that order matters: an
 * escaped `&lt;script&gt;` would otherwise be turned into a tag by the decode
 * and then survive the strip.
 *
 * @param maxChars - Where to cut. Absent means keep whatever there is, which is
 *   what a caller that has already bounded the input wants.
 */
export function plainText(raw: string, maxChars?: number): string | undefined {
    const stripped = decodeEntities(raw.replace(/<[^>]*>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();

    if (stripped.length === 0) return undefined;
    return maxChars === undefined ? stripped : truncateWords(stripped, maxChars);
}

/**
 * Text cut at a word boundary where there is one nearby, with an ellipsis.
 *
 * A summary that ends mid-word reads as a broken feed rather than as a
 * truncation, which is the difference between a listener hearing a station
 * quoting a publisher and one hearing a station malfunction.
 */
export function truncateWords(value: string, maxChars: number): string {
    if (value.length <= maxChars) return value;

    const cut = value.slice(0, maxChars);
    const lastSpace = cut.lastIndexOf(' ');
    return `${(lastSpace > maxChars - 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Where one sentence ends and the next begins.
 *
 * A terminator, any closing quote or bracket after it, whitespace, and then
 * something that starts a sentence. The lookahead is what does the work: a
 * full stop followed by a digit or a lowercase letter is an abbreviation or a
 * decimal, not an ending. Measured on a real wire story — "Saturday, Aug. 15,
 * 2026" was being read as a complete sentence and a bulletin said it out loud.
 */
const SENTENCE_END = /[.!?]["'”’)\]]*\s+(?=["'“‘(]?[A-Z0-9])/g;

/**
 * The abbreviations the lookahead cannot catch, because a name follows them and
 * a name is capitalised.
 *
 * Short and deliberately not a gazetteer: every entry here is one that turns up
 * in news copy, and the cost of a miss is one sentence cut early rather than
 * anything false. Matched with the full stop already consumed.
 */
const ABBREVIATIONS =
    /\b(mr|mrs|ms|dr|prof|rev|st|jr|sr|gov|sen|rep|lt|sgt|col|gen|capt|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec|no|vs|approx|est|inc|ltd|co|dept|univ|u\.s|u\.k)$/i;

/** Whether the stop at `at` really ends a sentence, or belongs to an abbreviation. */
const endsSentence = (value: string, at: number): boolean => !ABBREVIATIONS.test(value.slice(Math.max(0, at - 12), at));

/**
 * The first sentence of a passage, as published, or the whole thing when it is
 * one sentence.
 *
 * Here rather than in a caller because both consumers of prose need it and
 * neither should be splitting sentences by hand: a station reads the opening
 * line of a story aloud, and a truncation cuts at the last one that fits.
 */
export function firstSentence(value: string): string {
    const text = value.trim();

    SENTENCE_END.lastIndex = 0;
    for (let match = SENTENCE_END.exec(text); match !== null; match = SENTENCE_END.exec(text)) {
        const stop = match.index;
        if (endsSentence(text, stop)) return text.slice(0, stop + 1).trim();
    }

    return text;
}

/**
 * Text cut at the last SENTENCE that fits, with no ellipsis.
 *
 * The other kind of cut, and the one that belongs on anything a voice will read
 * or a model will be told is the story: half a sentence is something to finish,
 * and a model handed one finishes it out of its own head — which is exactly the
 * failure a bulletin cannot have. Falls back to {@link truncateWords} when the
 * first sentence is already longer than the cap, because a hard stop mid-clause
 * is still better than three paragraphs.
 */
export function truncateSentences(value: string, maxChars: number): string {
    if (value.length <= maxChars) return value;

    let lastStop = -1;
    SENTENCE_END.lastIndex = 0;
    for (let match = SENTENCE_END.exec(value); match !== null; match = SENTENCE_END.exec(value)) {
        if (match.index >= maxChars) break;
        if (endsSentence(value, match.index)) lastStop = match.index;
    }

    if (lastStop <= 0) return truncateWords(value, maxChars);
    return value.slice(0, lastStop + 1).trimEnd();
}

/** How many words a passage is, on the one definition every caller here uses. */
const wordsIn = (value: string): number => value.split(/\s+/).filter(Boolean).length;

/**
 * The closing quotes and brackets a boundary swallowed, so a cut keeps them.
 *
 * {@link SENTENCE_END} matches the terminator, then any closers, then the
 * whitespace before the next sentence. Cutting at the terminator alone leaves
 * the closer at the head of the half that was thrown away, which turns `as
 * "love."` into `as "love.` — an unbalanced quote in something a voice reads.
 */
const closersIn = (boundary: string): string => boundary.slice(1).trimEnd();

/**
 * The longest run of WHOLE sentences within a word count, or nothing.
 *
 * The word-counted sibling of {@link truncateSentences}, and the difference
 * between them is the fallback rather than the unit. That one cuts mid-clause
 * when the first sentence is already too long, because its caller would rather
 * have a hard stop than three paragraphs. This one answers `undefined`, because
 * its caller is choosing between a script and something else it can say
 * instead, and half a sentence read aloud is worse than either.
 *
 * A passage already within the count comes back trimmed and otherwise
 * untouched, so a caller can put this in front of everything rather than
 * branching on the length itself.
 */
export function sentencesWithin(value: string, maxWords: number): string | undefined {
    const text = value.trim();
    if (wordsIn(text) <= maxWords) return text;

    let fits: string | undefined;

    SENTENCE_END.lastIndex = 0;
    for (let match = SENTENCE_END.exec(text); match !== null; match = SENTENCE_END.exec(text)) {
        if (!endsSentence(text, match.index)) continue;

        const ending = text.slice(0, match.index + 1 + closersIn(match[0]).length);
        if (wordsIn(ending) > maxWords) break;
        fits = ending;
    }

    return fits;
}
