import type { AnswerGuard } from './break.prompt.js';
import { NOT_A_HABIT, withoutRecordNames } from './break.prompt.js';

/**
 * Whether a break actually told the story it was handed.
 *
 * ## Why this is asked at all, and why not of the model
 *
 * A story on a talk break is OFFERED: the prompt says outright that it may be left alone, and most
 * breaks will leave it alone. So "the story was in the prompt" says nothing about whether a listener
 * heard it, and two things downstream need the difference — the rotation, which must move on
 * whenever a story was carried so one the model keeps passing over cannot block the shelf, and a
 * story's own progress, which must move only when it was actually told.
 *
 * The alternative is a field in the answer the model fills in. `weather.figures.ts` records why that
 * is not an option and the reasoning is unchanged here: it is asking a model to tell us what it just
 * did, which is the check that approves its own work.
 *
 * ## It leans NO, which is the opposite of `claimsNext` and deliberate
 *
 * `claimsNext` assumes the break named the record, because over-stamping costs at most a break the
 * running order drifted under. Here the two failures are not symmetrical either, but they point the
 * other way:
 *
 * - a false NO tells the story again, in different words, bounded by the cadence gap — a listener
 *   hears the character return to something, which is what this feature is for;
 * - a false YES marks a part as told that nobody heard, and the next break moves past it. The
 *   listener never gets that piece of the story, and nothing anywhere will notice.
 *
 * So the bar is two distinct anchors rather than one. One shared word between a forty-word break and
 * a story about the same evening is a coincidence; two is the break reaching for the material.
 *
 * ## What an anchor is
 *
 * The distinctive words of the text the break was SHOWN, which is the story and whatever details
 * came with it — or, once a story has parts, the part it was handed. Short words and the grammar
 * every sentence needs are dropped through {@link NOT_AN_ANCHOR}, because "there" appearing in both
 * is not evidence of anything.
 *
 * Record names come out of the script first, through the same {@link withoutRecordNames} the clock
 * and character checks use. A story about a desert offered in front of a record called `Desert` is
 * otherwise one anchor up before the break has said anything at all.
 *
 * A character's own diction is excluded by the caller rather than here: those words are asked for by
 * name in every prompt and counted in every answer, so they appear in both texts whatever the break
 * did, and counting them would mark every break as having told the story.
 *
 * ## What it cannot catch
 *
 * A break that told the story entirely in its own words — "you never did work out what those lights
 * were" against a story that never uses the word `lights`. It answers no, the part is offered again,
 * and the cost is bounded by the gap. That is the deliberate floor, and it is measurable before it
 * matters: an audition run reports what this answered for every break it wrote, which is where the
 * bar gets checked against real scripts rather than against this paragraph.
 */
export function mentionsStory(script: string, shown: StoryShown, guard: AnswerGuard = {}): boolean {
    const anchors = anchorsOf(shown);
    if (anchors.size === 0) return false;

    const said = new Set(wordsIn(withoutRecordNames(script, guard)));

    let found = 0;
    for (const anchor of anchors) {
        if (said.has(anchor)) found += 1;
        if (found >= required(anchors.size)) return true;
    }

    return false;
}

/** The text a break was shown, and the words it must not be judged on. */
export interface StoryShown {
    /** The telling itself, or the one part of it this break was handed. */
    text: string;
    /** What came with it, which a break may reach for instead of the telling. */
    details?: readonly string[];
    /**
     * The character's own diction markers, which are excluded.
     *
     * Asked for by name in every prompt and counted in every answer, so a marker that also appears
     * in a story is a word the break was always going to say. Counting it would mark every break as
     * having told the story, which is `overusedWords`' hazard one file over.
     */
    diction?: readonly string[];
}

/**
 * Two, or all of them when a story has fewer than two distinctive words to offer.
 *
 * A one-anchor story is one somebody wrote in six words, and refusing to ever stamp it would leave
 * exactly those stories never progressing.
 */
const required = (anchors: number): number => Math.min(2, anchors);

/** The distinctive words of the text a break was shown. */
function anchorsOf(shown: StoryShown): Set<string> {
    const excluded = new Set((shown.diction ?? []).flatMap(marker => wordsIn(marker)));
    const anchors = new Set<string>();

    for (const word of wordsIn([shown.text, ...(shown.details ?? [])].join(' '))) {
        if (excluded.has(word)) continue;
        anchors.add(word);
    }

    return anchors;
}

/** Lower-cased words of at least {@link MIN_ANCHOR_LENGTH}, with the grammar dropped. */
function wordsIn(text: string): string[] {
    return (
        text
            .toLowerCase()
            .replace(/[‘’ʼ′]/g, "'")
            .match(/[a-z0-9']+/g) ?? []
    ).filter(word => word.length >= MIN_ANCHOR_LENGTH && !NOT_AN_ANCHOR.has(word));
}

/**
 * Below this a word says nothing about whether a story was told.
 *
 * `overusedWords`' four rather than something longer, and it was measured against a real case: the
 * night the dogs would not go out is a story whose one distinctive word is `dogs`, and a floor of
 * five drops it and leaves that detail unmatchable. Short words that ARE only grammar are excluded
 * by name below rather than by length, which is the same division `NOT_A_HABIT` already makes.
 */
const MIN_ANCHOR_LENGTH = 4;

/**
 * Words a sentence needs, which a story and a break will share whatever either of them is about.
 *
 * `NOT_A_HABIT` itself, plus the longer function words it has no reason to carry: that list is
 * built for four-letter tics and this one has to reach `something` and `because` too.
 *
 * Its rule comes with it — grammar rather than vocabulary. The temptation is to grow this until
 * nothing coincidental matches, and that is the wrong direction, because the words that actually
 * carry a story are ordinary ones and a list long enough to be safe would leave nothing to match
 * on. The two-anchor bar is what handles coincidence; this is only for words that are not evidence
 * at any count.
 */
const NOT_AN_ANCHOR = new Set([
    ...NOT_A_HABIT,
    'after',
    'again',
    'their',
    'these',
    'thing',
    'think',
    'those',
    'through',
    'until',
    'would',
    'could',
    'should',
    'because',
    'before',
    'being',
    'every',
    'never',
    'other',
    'still',
    'something',
    'anything',
    'nothing',
]);
