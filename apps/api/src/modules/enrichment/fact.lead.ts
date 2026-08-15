/**
 * The floor under fact extraction: the opening of an article, taken as it
 * stands.
 *
 * An encyclopaedia's first sentence is already a sourced, speakable claim
 * somebody wrote on purpose — "Rusty Cage is a song by the American rock band
 * Soundgarden, released in 1992 as the third single from Badmotorfinger" — and
 * taking it verbatim needs no model, no prompt and no verification pass,
 * because the claim and the quote it rests on are the same span of text. There
 * is nothing here that can be hallucinated: the worst failure available is
 * quoting a sentence that was already wrong upstream, which is a different
 * thing and one the citation lets a reader see.
 *
 * That is the whole point of it existing separately from the model pass. A
 * station with no model plugin, or one whose model is busy writing a break,
 * still fills its fact store — the same shape as `BreakWriterRegistry` and
 * `SetGeneratorChain`, where the interesting binding goes in front and the one
 * that cannot fail goes behind it.
 *
 * Pure, and tested against real article openings, because every judgement it
 * makes is about text nobody will read again before it is spoken.
 */

/** How many sentences off the top are worth taking. */
export const MAX_LEAD_CLAIMS = 2;

/**
 * The length a claim has to fall inside to be usable.
 *
 * The floor is not about information, it is about grammar: a fragment under
 * thirty characters is a heading, a stray date, or the tail of a sentence the
 * splitter cut in the wrong place. The ceiling is the column's own, and a
 * sentence approaching it is a paragraph that was never punctuated.
 */
export const MIN_CLAIM_CHARS = 30;
export const MAX_CLAIM_CHARS = 400;

/**
 * Abbreviations that end in a full stop and do not end a sentence.
 *
 * Not an attempt at a general splitter. These are the ones that actually occur
 * in the opening lines of music articles, and each one that is missing costs a
 * claim cut in half — which is the failure mode that matters here, since half a
 * sentence is worse than no sentence when what happens to it is a mouth.
 */
const ABBREVIATIONS = /\b(?:Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|feat|ft|no|No|Vol|Op|approx|est|c|ca|fl|b|d|i\.e|e\.g|etc|U\.S|U\.K|[A-Z])\.$/;

/** A pronunciation gloss or a foreign-script rendering of the title, which nobody wants read out. */
const GLOSS = /\((?:[^()]*(?:pronounced|IPA|listen|help·info|born|née|Japanese|Korean|Chinese|Russian|Hebrew|Arabic|lit\.)[^()]*)\)/gi;

/** Wikipedia's own inline furniture: reference markers and edit hints that survive a plaintext extract. */
const FURNITURE = /\[(?:\d+|citation needed|note \d+|[a-z])\]/gi;

/**
 * A run of those markers sitting immediately after a full stop.
 *
 * Its own pattern because it is a SENTENCE BOUNDARY question rather than a
 * tidying one. A citation lands between the stop and the space — "released in
 * 1992.[3] It sold" — so a splitter looking for punctuation followed by a space
 * sees no boundary there and swallows the rest of the paragraph into one claim
 * that the length cap then throws away. On a real article that is most of them.
 */
const TRAILING_MARKERS = /^(?:\[[^\]]{1,24}\])+/;

/**
 * The first paragraph, which is the only part of an article that is reliably a
 * summary of the whole thing.
 *
 * A plaintext extract separates sections and paragraphs with newlines, and
 * everything past the first blank line is detail: a track listing, a personnel
 * credit, a chart table flattened into prose. The lead is the part written to
 * be read on its own.
 */
export function leadParagraph(text: string): string {
    for (const block of text.split(/\n+/)) {
        const paragraph = block.trim();
        // A section heading survives the extract as a short line of its own.
        // Skipping those rather than stopping at them means an article whose
        // extract begins with one still contributes its lead.
        if (paragraph.length >= MIN_CLAIM_CHARS) return paragraph;
    }

    return '';
}

/**
 * A paragraph split where sentences actually end.
 *
 * Deliberately simple, and biased towards NOT splitting: a missed boundary
 * yields one long claim that the length cap then drops, while a wrong boundary
 * yields a confident half-sentence that reads perfectly well right up until it
 * stops mid-clause on air.
 */
export function sentences(paragraph: string): string[] {
    const found: string[] = [];
    let start = 0;

    for (let at = 0; at < paragraph.length; at++) {
        const character = paragraph[at];
        if (character !== '.' && character !== '!' && character !== '?') continue;

        // Citations ride between the stop and the space, so they are stepped
        // over here and kept INSIDE the sentence: the quote has to be findable
        // in the document, and cutting the marker off the end of one would only
        // make it findable when the marker happened to be last.
        const rest = paragraph.slice(at + 1);
        const markers = TRAILING_MARKERS.exec(rest)?.[0] ?? '';
        const following = rest.slice(markers.length);

        // A boundary is punctuation followed by a space and a capital. Anything
        // else is a decimal, an ellipsis, or an abbreviation mid-flow.
        if (following.length > 0 && following[0] !== ' ' && following[0] !== '\n') continue;

        const end = at + 1 + markers.length;
        const candidate = paragraph.slice(start, end).trim();
        if (ABBREVIATIONS.test(candidate)) continue;

        const next = following.trimStart();
        if (next.length > 0 && next[0] !== next[0]?.toUpperCase()) continue;

        if (candidate.length > 0) found.push(candidate);
        start = end;
    }

    const tail = paragraph.slice(start).trim();
    if (tail.length > 0) found.push(tail);

    return found;
}

/**
 * A sentence with the things a reader skips taken out.
 *
 * Reference markers and pronunciation glosses both survive a plaintext extract
 * and are both unspeakable, in the literal sense: a voice engine reads "[3]"
 * aloud, and a gloss is a parenthesis of phonetics in the middle of the one
 * sentence that was supposed to be the clean one.
 */
export function tidy(sentence: string): string {
    return sentence
        .replace(FURNITURE, '')
        .replace(GLOSS, '')
        .replace(/\s+([,.;:])/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Whether a sentence is one the station could say.
 *
 * The bracket check is the load-bearing one. Stripping a gloss out of the
 * middle of a sentence can leave an orphaned bracket behind, and a claim
 * carrying one is a claim whose text was mangled — the correct response to
 * which is to drop it, not to patch it up and hope.
 */
export function speakable(sentence: string): boolean {
    if (sentence.length < MIN_CLAIM_CHARS || sentence.length > MAX_CLAIM_CHARS) return false;

    const opens = (sentence.match(/[([]/g) ?? []).length;
    const closes = (sentence.match(/[)\]]/g) ?? []).length;
    if (opens !== closes) return false;

    // It has to end like a sentence. A lead cut off by the extract's own length
    // limit ends mid-word, and the extract API does that on very long articles.
    return /[.!?]$/.test(sentence);
}

/** One claim, before it is a row. */
export interface LeadClaim {
    claim: string;
    /** The span of the document that supports it, which for this extractor is the sentence itself. */
    sourceQuote: string;
}

/**
 * The claims an article's opening yields, in order.
 *
 * `sourceQuote` is the sentence as it appears in the document, BEFORE tidying,
 * so it can still be found in the text a reader is sent to. The claim is the
 * tidied one, because that is what gets spoken. Keeping them apart is what lets
 * the verification rule ("the quote must occur in the document") stay true of
 * every row in the table, whichever extractor wrote it.
 */
export function leadClaims(document: { text: string }, limit = MAX_LEAD_CLAIMS): LeadClaim[] {
    const paragraph = leadParagraph(document.text);
    if (paragraph.length === 0) return [];

    const claims: LeadClaim[] = [];
    for (const sentence of sentences(paragraph)) {
        const claim = tidy(sentence);
        if (!speakable(claim)) continue;

        claims.push({ claim, sourceQuote: sentence });
        if (claims.length >= limit) break;
    }

    return claims;
}
