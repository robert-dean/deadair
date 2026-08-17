/**
 * What is wrong with a drafted beat, judged without a model.
 *
 * The `polished` mode's third pass, and it is arithmetic on purpose. A model asked whether its own
 * draft is any good says yes — the same reason `fact.model.ts` verifies a claim in a SEPARATE
 * conversation that has never seen the article — and everything worth catching here is measurable
 * anyway: a beat that repeats an earlier one, one that came back at half the length it was asked
 * for, one that re-introduces a programme already in progress.
 *
 * ## It answers a LIST, most important first
 *
 * Not a boolean, and not the first problem it finds. A beat is re-drafted at most once, so the one
 * correction it gets has to carry everything wrong with it — fixing the length and being told about
 * the repetition on a second pass that never comes is worse than useless.
 *
 * Ordered because the correction is read by a model with finite attention: the problems that change
 * what the beat SAYS come before the ones that change how long it is.
 *
 * ## What it deliberately does not judge
 *
 * Character and diction, which `readAnswer` and `characterFault` already own for breaks and which a
 * production inherits by going through the same writers. Duplicating either here would give a beat
 * two judges that can disagree.
 */

import { expectedWords, MAX_WORDS } from './production.plan.js';

/**
 * How far outside its budget a beat may come back before that is worth a re-draft.
 *
 * Wide, and deliberately: the budget is an instruction about pace rather than a contract, and a beat
 * ten percent long is a beat that had something to say. What these catch is the beat that came back
 * as a sentence, and the one that ran away.
 */
export const MIN_RATIO = 0.45;
export const MAX_RATIO = 1.8;

/**
 * How much three-word-sequence overlap with an earlier beat counts as repeating it.
 *
 * Trigrams rather than whole sentences, because a model repeating itself rarely does so word for
 * word — it re-states the same point in slightly different words, which shares its phrases without
 * sharing a single line.
 */
export const DUPLICATE_OVERLAP = 0.35;

/**
 * Markup a beat should never contain, because a beat is SPOKEN.
 *
 * Not a style preference: the speech engine reads what it is given, so a model that emphasised a
 * word as `*yikes*` has written an asterisk into the audio. Measured on a live run, where the
 * presenter's own exclamations came back wrapped in them.
 *
 * Deliberately narrow. An apostrophe, a dash and a question mark are all ordinary speech; these five
 * are the ones that only exist to be looked at.
 */
const MARKUP = /(\*\*?|^#{1,6}\s|^\s*[-*]\s|`|_[A-Za-z])/m;

/** How much of the run-in a beat may echo before it is reciting rather than continuing. */
export const RUN_IN_ECHO_WORDS = 6;

/** What one beat is judged against. */
export interface BeatCheckInput {
    /** The drafted words. */
    text: string;
    /** About how many spoken words it was asked for. */
    words: number;
    /** Where it comes, from 0. Beat 0 is the only one allowed to open the programme. */
    ordinal: number;
    /** The beats already written, for the repetition check. */
    priorBeats?: readonly string[];
    /**
     * The words this beat was handed to carry on from.
     *
     * Checked because handing a model a quotation makes it read the quotation: beats opened by
     * reciting the previous one's last sentence word for word. The whole-beat overlap check cannot
     * catch it — one sentence in two hundred words is well under the duplicate threshold — so the
     * run-in is compared against the OPENING specifically.
     */
    runIn?: string;
}

/** A beat that opens a programme, so the check knows an opening is only wrong out of place. */
const OPENING = /\b(welcome (back )?to|you're listening to|this is .{0,40}\bpodcast\b|in this (episode|programme|program)|hello and welcome)\b/i;

/**
 * Read a drafted beat and answer with what is wrong, most important first.
 *
 * An empty array means it is good enough to keep. Nothing here throws: a beat that arrived as
 * nonsense is a beat with problems, not an exception.
 */
export function checkBeat(input: BeatCheckInput): string[] {
    const problems: string[] = [];
    const text = input.text.trim();

    // Nothing else is worth reporting: there are no words to judge. This is a real answer rather
    // than a defensive one — a model that spends its whole output allowance on reasoning returns
    // exactly this, which is observable in this station's own logs.
    if (text.length === 0) {
        return ['The beat came back empty. Write it as continuous spoken prose, with no headings, stage directions or bullet points.'];
    }

    const spoken = countWords(text);
    const target = expectedWords(input.words);

    if (spoken < Math.round(target * MIN_RATIO)) {
        problems.push(
            `The beat is too short: ${spoken} spoken words against a target of about ${input.words}. Develop it further rather than summarising it.`,
        );
    } else if (spoken > Math.round(input.words * MAX_RATIO)) {
        problems.push(`The beat is far too long: ${spoken} spoken words against a target of about ${input.words}. Tighten it to the target.`);
    }

    // Beat 0 is the opening, so an opening there is correct. Anywhere else it is a model that
    // forgot it was in the middle of something — which is what makes a production sound like
    // several short programmes played back to back rather than one.
    if (input.ordinal > 0 && OPENING.test(text)) {
        problems.push('This beat is mid-programme but it introduces the programme again. Cut the greeting and pick it up in progress.');
    }

    if (input.runIn !== undefined && echoesRunIn(input.runIn, text)) {
        problems.push(
            'This beat begins by repeating the words it was told to carry on from. Those have already been said: start after them, with something new.',
        );
    }

    if (MARKUP.test(text)) {
        problems.push(
            'This beat contains formatting — asterisks, hashes, backticks or bullet points. It is read aloud exactly as written, so write it as plain spoken prose.',
        );
    }

    const overlap = Math.max(0, ...(input.priorBeats ?? []).map(prior => trigramOverlap(prior, text)));
    if (overlap >= DUPLICATE_OVERLAP) {
        problems.push(
            'This beat repeats an earlier one almost word for word. Say something new: a different angle, different phrasing, and no re-stating what has already been covered.',
        );
    }

    return problems;
}

/**
 * The correction appended to a beat's prompt for its one re-draft.
 *
 * "Rewrite it from scratch" rather than "fix these", because a model handed its own draft and a list
 * of complaints edits around them and keeps the shape that produced them — which is exactly what
 * fails again on a beat that was too short or that repeated an earlier one.
 */
export function correctionNote(problems: readonly string[]): string {
    return [
        'Your previous attempt at this beat had problems. Rewrite it from scratch and fix them:',
        ...problems.map(problem => `- ${problem}`),
    ].join('\n');
}

/**
 * Whether a beat opens by reciting what it was handed rather than continuing from it.
 *
 * Compares the END of the run-in against the START of the beat, which is where the echo happens: a
 * model picks the quotation up and reads it before saying anything of its own. Anywhere else in the
 * beat is the ordinary duplicate check's business.
 */
function echoesRunIn(runIn: string, text: string): boolean {
    const tail = words(runIn);
    const head = words(text).slice(0, tail.length + RUN_IN_ECHO_WORDS);
    if (tail.length < RUN_IN_ECHO_WORDS || head.length < RUN_IN_ECHO_WORDS) return false;

    // Any run of RUN_IN_ECHO_WORDS from the run-in appearing in the beat's opening is an echo.
    for (let at = 0; at + RUN_IN_ECHO_WORDS <= tail.length; at++) {
        const run = tail.slice(at, at + RUN_IN_ECHO_WORDS).join(' ');
        if (head.join(' ').includes(run)) return true;
    }
    return false;
}

/** A text as lowercase words, with punctuation dropped so an echo cannot hide behind it. */
const words = (text: string): string[] =>
    text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean);

/** Spoken words in a chunk of text. */
export function countWords(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * How much of the shorter text's three-word sequences appear in the longer one, from 0 to 1.
 *
 * Against the SHORTER side deliberately: a 40-word beat entirely lifted from a 200-word one shares
 * only a fifth of the longer text's phrases, and judging it that way would miss the case worth
 * catching. Two texts with nothing to compare answer 0 rather than dividing by zero.
 */
export function trigramOverlap(left: string, right: string): number {
    const one = trigrams(left);
    const two = trigrams(right);
    const smaller = one.size <= two.size ? one : two;
    const larger = one.size <= two.size ? two : one;
    if (smaller.size === 0) return 0;

    let shared = 0;
    for (const gram of smaller) if (larger.has(gram)) shared += 1;

    return shared / smaller.size;
}

/** Every three-word sequence in a text, normalized so punctuation and case do not hide a repeat. */
function trigrams(text: string): Set<string> {
    const words = text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean);

    const grams = new Set<string>();
    for (let index = 0; index + 2 < words.length; index++) grams.add(`${words[index]} ${words[index + 1]} ${words[index + 2]}`);

    return grams;
}

/** Re-exported so a caller judging a beat needs one import rather than two. */
export { MAX_WORDS };
