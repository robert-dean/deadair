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

    const cut = value.slice(0, maxChars);
    const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    if (lastStop <= 0) return truncateWords(value, maxChars);

    return cut.slice(0, lastStop + 1).trimEnd();
}
