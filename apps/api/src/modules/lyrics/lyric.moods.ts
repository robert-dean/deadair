import { createHash } from 'node:crypto';
import type { LlmMessage } from '@deadair/plugin-sdk';

/**
 * What mood a record is in, as a model judges it from the record's lyric and, where the station can
 * search, from what the web says about the record.
 *
 * Pure: the prompt, the parse and the version. The walk that runs it is `LyricMoodsService`.
 *
 * ## A distribution, never a single word
 *
 * A comparable implementation measured how far a single mood label read off lyrics can be trusted,
 * against several hundred records labelled by hand: the strict seven-way choice was right about a
 * third of the time, and a plain positive-or-negative call did no better than chance. What made it
 * usable at all was keeping the WHOLE distribution and selecting on the share a record gives the
 * mood wanted. So that is what is asked for and stored, and what reads it only ever leans on it
 * (`director/mood.lean.ts`), never filters with it.
 *
 * ## Why a record's lyric does not leave here as words
 *
 * The lyric is in the prompt, which is the one place it may go: it is read, not said, and nothing
 * here asks for any of it back. The answer is seven numbers, which cannot quote anything, and a
 * page the model finds about the record cannot reach the air through them either.
 */

/** The moods a record can be in. Fixed, because the slot's mood and the stored distributions have to name the same seven. */
export const LYRIC_MOODS = ['love', 'happiness', 'comfort', 'sadness', 'loneliness', 'anger', 'fear'] as const;

export type LyricMood = (typeof LYRIC_MOODS)[number];

/** How many mood stages a slot or a broadcast may pass through. See `director/mood.lean.ts`. */
export const MAX_MOOD_STAGES = 4;

/**
 * A stored or sent list of mood stages as the code reads it: the known moods only, in order, at most
 * {@link MAX_MOOD_STAGES}, and `undefined` rather than an empty list, so "no lean" has one spelling.
 */
export function moodStages(values: readonly unknown[] | null | undefined): LyricMood[] | undefined {
    const stages = (values ?? [])
        .filter((value): value is LyricMood => (LYRIC_MOODS as readonly unknown[]).includes(value))
        .slice(0, MAX_MOOD_STAGES);
    return stages.length === 0 ? undefined : stages;
}

/** {@link moodStages} as a field to spread: `{ moods }`, or nothing at all for no lean. */
export function moodsField(values: readonly unknown[] | null | undefined): { moods?: LyricMood[] } {
    const moods = moodStages(values);
    return moods === undefined ? {} : { moods };
}

/** What each mood means, as the model is told it. The wording is part of {@link MOODS_VERSION}. */
const MOOD_MEANING: Record<LyricMood, string> = {
    love: 'affection, romance, desire, or loving memory',
    happiness: 'joy, celebration, a good time, pride or hope',
    comfort: 'safety, warmth, support, calm or relief',
    sadness: 'grief, loss, despair or regret',
    loneliness: 'isolation, longing, missing someone, being left',
    anger: 'rage, defiance, bitterness or protest',
    fear: 'dread, anxiety, menace or paranoia',
};

/** How much lyric the model is shown. A whole song fits; this bounds a source that handed over a page. */
export const MAX_PROMPT_LYRIC_CHARS = 4_000;

const SYSTEM = [
    'You judge what mood a song is in, for a radio station choosing what to play.',
    '',
    'Moods:',
    ...LYRIC_MOODS.map(mood => `- ${mood}: ${MOOD_MEANING[mood]}`),
    '',
    'Rules:',
    '- Judge the feeling the song leaves a listener with, not the topic it mentions in passing.',
    '- Spread the weight over every mood that fits. A song can be mostly sadness and a little love.',
    '- If you are given the lyric, read it. If you can look things up, you may search for what the song is about, but trust the lyric over a page about it.',
    '- If you cannot tell, say so. Guessing is worse than saying you cannot tell.',
    '- Never quote the lyric or a page in your answer.',
    '',
    'Answer with JSON only, in one of these two shapes, and nothing else:',
    `{"moods":{${LYRIC_MOODS.map(mood => `"${mood}":0.0`).join(',')}}}`,
    '{"unknown":true}',
    'The seven numbers are shares between 0 and 1 and should add up to 1.',
].join('\n');

/**
 * Which wording a stored distribution was judged under.
 *
 * A hash of the moods and the instructions, so editing either makes every stored row STALE and the
 * walk judges the library again under the new words, on `track_analysis`'s rule. The model is not
 * part of it: a model change is the operator's to decide whether to re-run, and silently re-judging a
 * whole library on a settings change would be a week of background work nobody asked for.
 */
export const MOODS_VERSION = `m1-${createHash('sha256').update(SYSTEM).digest('hex').slice(0, 12)}`;

/** The record being judged. */
export interface MoodSubject {
    title: string;
    artist: string;
    album?: string;
    year?: number;
    /** The lyric, when the station holds one. */
    lyric?: string;
    /** Whether a source said nobody sings on it. */
    instrumental?: boolean;
}

export function moodsPrompt(subject: MoodSubject, canSearch: boolean): LlmMessage[] {
    const what = [
        `"${subject.title}" by ${subject.artist}`,
        subject.album ? `from ${subject.album}` : undefined,
        subject.year ? `(${subject.year})` : undefined,
    ]
        .filter(part => part !== undefined)
        .join(' ');

    const lines = [`The song is ${what}.`];
    if (subject.instrumental) lines.push('It is an instrumental: nobody sings on it, so judge it by what is known about it.');
    if (subject.lyric) {
        lines.push('', 'Its lyric:', '', subject.lyric.slice(0, MAX_PROMPT_LYRIC_CHARS));
    } else if (!subject.instrumental) {
        lines.push('You have not been given its lyric.');
    }
    if (canSearch) lines.push('', 'You can search the web for what this song is about before you answer.');

    return [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: lines.join('\n') },
    ];
}

/** A judged distribution, keyed by mood, summing to 1. */
export type MoodDistribution = Record<LyricMood, number>;

/**
 * The model's answer as a distribution, `unknown` when it said it cannot tell, or `undefined` for an
 * answer that is neither (which the walk records as a failure, to be asked again later).
 *
 * Normalised to sum to 1, because a model that writes seven numbers rarely makes them add up. A
 * mood it left out is zero. Anything negative, non-numeric or all-zero is not an answer.
 */
export function readMoods(answer: string): MoodDistribution | 'unknown' | undefined {
    const start = answer.indexOf('{');
    const end = answer.lastIndexOf('}');
    if (start < 0 || end <= start) return undefined;

    let parsed: unknown;
    try {
        parsed = JSON.parse(answer.slice(start, end + 1));
    } catch {
        return undefined;
    }
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    if ((parsed as { unknown?: unknown }).unknown === true) return 'unknown';

    const moods = (parsed as { moods?: unknown }).moods;
    if (typeof moods !== 'object' || moods === null) return undefined;

    const raw = LYRIC_MOODS.map(mood => (moods as Record<string, unknown>)[mood] ?? 0);
    if (raw.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) return undefined;

    const total = (raw as number[]).reduce((sum, value) => sum + value, 0);
    if (total <= 0) return undefined;

    return Object.fromEntries(
        LYRIC_MOODS.map((mood, index) => [mood, Math.round(((raw[index] as number) / total) * 1000) / 1000]),
    ) as MoodDistribution;
}
