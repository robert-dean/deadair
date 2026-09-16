/**
 * Packing something long into as few speech calls as the engine will take.
 *
 * The station has never needed this: a break is a few hundred words and goes to the engine whole.
 * Reading somebody else's writing out is the case where the length is not the station's to choose,
 * so the text has to be cut somewhere, and where it is cut is audible.
 *
 * ## Why not simply cut every N characters
 *
 * Every seam is a join between two separately synthesised pieces, and an engine reads a fragment as
 * a fragment: cut mid-sentence and the first half falls away at the end like a full stop while the
 * second starts cold, which no gap between them can repair. So the cut goes at the strongest
 * boundary available inside the ceiling, and the ladder below is that in order of preference. Fewer
 * calls is the second goal and never the first, though it mostly follows: the best boundary is
 * usually also the furthest one.
 *
 * ## The ladder
 *
 * A paragraph, then a sentence, then a word, then a hard cut. That last one is only for a single
 * "word" longer than the whole ceiling, which is a URL or a corrupt file rather than prose, and
 * refusing it would cost the listener the chapter over one pathological token.
 */

/** One run of text as the caller divided it, which is a paragraph in every case this exists for. */
export interface TextPart {
    text: string;
}

/**
 * What separates two parts inside one packed call.
 *
 * A blank line rather than a space, because that is what the parts MEAN: the caller drew a paragraph
 * boundary and an engine reads the double break as the pause a paragraph gets. Joining them with a
 * space would pack exactly as well and read as one long undivided passage.
 */
const PARAGRAPH_GAP = '\n\n';

/**
 * Sentence-ish boundaries for text `Intl.Segmenter` cannot help with.
 *
 * Only reached when the runtime has no segmenter for the locale asked for, which is rare and
 * survivable: what it costs is a worse cut in a language whose punctuation this does not know.
 * Deliberately includes the CJK and Devanagari stops, since the engines this station speaks with
 * offer those voices.
 */
const SENTENCE_FALLBACK = /[^.!?。！？।]+[.!?。！？।]+["'”’)\]]*\s*|[^.!?。！？।]+$/g;

/**
 * Split `text` into sentences, by the rules of `locale` where the runtime knows them.
 *
 * Exported because it is the half worth testing directly and the half most likely to be wanted
 * elsewhere: where a sentence ends is a question about a language, not about audio.
 */
export function sentencesIn(text: string, locale?: string): string[] {
    const trimmed = text.trim();
    if (trimmed.length === 0) return [];

    try {
        // `Intl.Segmenter` with no locale takes the runtime's, which is the right default. What it
        // buys over the fallback is the period that is not a full stop: it keeps `$3.50` and `1.5`
        // inside their sentence where the regex cuts after the first dot and starts the next
        // "sentence" at `50 for it`. Neither of them knows abbreviations, so both read `Dr.` as a
        // sentence of its own. That costs little here, since a one-word run is packed straight back
        // onto its neighbour unless the ceiling happens to fall between them.
        const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
        const sentences = [...segmenter.segment(trimmed)].map(part => part.segment.trim()).filter(sentence => sentence.length > 0);
        if (sentences.length > 0) return sentences;
    } catch {
        // An unknown locale tag, which is a plugin passing through whatever a file declared.
    }

    return (trimmed.match(SENTENCE_FALLBACK) ?? [trimmed]).map(sentence => sentence.trim()).filter(sentence => sentence.length > 0);
}

/**
 * Pack `parts` into the fewest strings that each fit inside `maxCharacters`.
 *
 * Whole parts while they fit, then the ladder above for one that does not. Empty parts are dropped
 * rather than packed, since a blank paragraph is a gap in a file rather than a silence somebody
 * asked for, and an all-empty input answers `[]`, which a caller must treat as "nothing to say"
 * rather than as one empty call.
 *
 * `maxCharacters` below 1 is meaningless and is read as 1, so a caller that resolved a nonsense
 * ceiling still terminates.
 */
export function packParts(parts: readonly TextPart[], maxCharacters: number, locale?: string): string[] {
    const ceiling = Math.max(1, Math.floor(maxCharacters));
    const packed: string[] = [];
    let current = '';

    const flush = (): void => {
        if (current.length > 0) packed.push(current);
        current = '';
    };

    /** Add one run that is known to fit on its own, starting a new call when it will not fit here. */
    const add = (run: string, separator: string): void => {
        if (current.length === 0) {
            current = run;
            return;
        }
        if (current.length + separator.length + run.length <= ceiling) {
            current = `${current}${separator}${run}`;
            return;
        }
        flush();
        current = run;
    };

    for (const part of parts) {
        const text = part.text.trim();
        if (text.length === 0) continue;

        if (text.length <= ceiling) {
            add(text, PARAGRAPH_GAP);
            continue;
        }

        // Too long whole: it gets its own calls, and the paragraph boundary in front of it is the
        // one place a seam was going to be anyway.
        flush();
        for (const sentence of sentencesIn(text, locale)) {
            if (sentence.length <= ceiling) {
                add(sentence, ' ');
                continue;
            }
            for (const run of splitLongSentence(sentence, ceiling)) add(run, ' ');
        }
    }

    flush();
    return packed;
}

/**
 * A sentence longer than the whole ceiling, cut at word boundaries.
 *
 * Rare in prose and ordinary in a transcript or a legal notice, neither of which the station gets to
 * refuse. A single token longer than the ceiling (a URL, a run of a corrupt file) is cut hard,
 * because the alternative is losing the whole piece over it.
 */
function splitLongSentence(sentence: string, ceiling: number): string[] {
    const runs: string[] = [];
    let run = '';

    for (const word of sentence.split(/\s+/).filter(word => word.length > 0)) {
        if (word.length > ceiling) {
            if (run.length > 0) {
                runs.push(run);
                run = '';
            }
            for (let at = 0; at < word.length; at += ceiling) runs.push(word.slice(at, at + ceiling));
            continue;
        }
        if (run.length === 0) {
            run = word;
            continue;
        }
        if (run.length + 1 + word.length <= ceiling) {
            run = `${run} ${word}`;
            continue;
        }
        runs.push(run);
        run = word;
    }

    if (run.length > 0) runs.push(run);
    return runs;
}
