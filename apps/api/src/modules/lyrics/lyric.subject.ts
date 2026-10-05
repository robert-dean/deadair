import { createHash } from 'node:crypto';
import type { LlmMessage } from '@deadair/plugin-sdk';
import { runOf } from '#modules/personas/persona.sheet.js';
import { MAX_PROMPT_LYRIC_CHARS, type MoodSubject } from './lyric.moods.js';

/**
 * What a record is ABOUT, in one sentence of the station's own words, judged by a model from the
 * record's lyric and, where the station can search, what is written about it.
 *
 * This is the one label that can put a copyrighted line on air, because it is words and a break
 * writer is shown it. So it is held to two rules the moods never needed. It is asked for in plain
 * words of the model's own, and it is CHECKED: a sentence sharing {@link SUBJECT_ECHO_WORDS} words in a
 * row with the lyric is refused and never stored. The writer is shown the label and never the lyric,
 * so a line it was never shown is one it cannot quote, and the guard on the break itself
 * (`quoted-lyric` in `break.prompt.ts`) catches one it knew anyway.
 *
 * And it is written to be SAYABLE, because a presenter may paraphrase it on air whatever the station's
 * advisory policy. The first live pass described a sex act in one subject and cocaine use in another,
 * both accurately; the rule asks for the subject named the way a presenter would name it, never the
 * act described. A station that speaks clean is not shown an explicit record's subject at all
 * (`subjectsForTracks`' `withholdExplicit`).
 */

/** The longest subject kept, in words. A presenter gets a sentence, not a review. */
export const MAX_SUBJECT_WORDS = 20;

/**
 * How many words in a row a subject or a break may share with the lyric before it counts as quoting it.
 *
 * Six, the sample-echo figure, and a lyric line shorter than that is never matched whole: a title is
 * often a line of the lyric, and naming the record is the job.
 */
export const SUBJECT_ECHO_WORDS = 6;

const SYSTEM = [
    'You say in one plain sentence what a song is about, for a radio presenter who will mention it.',
    '',
    'Rules:',
    `- One sentence, under ${MAX_SUBJECT_WORDS} words, in your own words.`,
    '- Never quote the lyric or a page, not even a phrase. Describe it instead.',
    '- Say what it is about, not whether it is good. No opinions, no "this song".',
    '- Write it so a radio presenter could say it on air. Name sex, drugs or violence plainly if that is what it is about, but never describe the act.',
    '- If you are given the lyric, read it. If you can look things up, you may search for what the song is about, but trust the lyric over a page about it.',
    '- If you cannot tell, say so. A wrong subject said on air is worse than none.',
    '',
    'Answer with JSON only, in one of these two shapes, and nothing else:',
    '{"about":"..."}',
    '{"unknown":true}',
].join('\n');

/** Which instructions a stored subject was written under. See `MOODS_VERSION` for why the model is not part of it. */
export const SUBJECT_VERSION = `s1-${createHash('sha256').update(SYSTEM).digest('hex').slice(0, 12)}`;

export function subjectPrompt(subject: MoodSubject, canSearch: boolean): LlmMessage[] {
    const what = [
        `"${subject.title}" by ${subject.artist}`,
        subject.album ? `from ${subject.album}` : undefined,
        subject.year ? `(${subject.year})` : undefined,
    ]
        .filter(part => part !== undefined)
        .join(' ');

    const lines = [`The song is ${what}.`];
    if (subject.instrumental) lines.push('It is an instrumental: nobody sings on it, so say what is known about it.');
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

/** Why an answer was not taken, for the log and the stored error. */
export type SubjectRefusal = 'unreadable' | 'too-long' | 'quoted-lyric';

/**
 * The model's answer: a subject to keep, `unknown` for "could not tell", or a refusal saying why it
 * was not kept. A subject that echoes the lyric is REFUSED rather than trimmed, because a quote with a
 * word changed is still the quote.
 */
export function readSubject(answer: string, lyric: string | undefined): { about: string } | 'unknown' | { refused: SubjectRefusal } {
    const start = answer.indexOf('{');
    const end = answer.lastIndexOf('}');
    if (start < 0 || end <= start) return { refused: 'unreadable' };

    let parsed: unknown;
    try {
        parsed = JSON.parse(answer.slice(start, end + 1));
    } catch {
        return { refused: 'unreadable' };
    }
    if (typeof parsed !== 'object' || parsed === null) return { refused: 'unreadable' };
    if ((parsed as { unknown?: unknown }).unknown === true) return 'unknown';

    const about = (parsed as { about?: unknown }).about;
    if (typeof about !== 'string' || about.trim().length === 0) return { refused: 'unreadable' };

    const text = about.trim().replace(/\s+/g, ' ');
    if (text.split(' ').length > MAX_SUBJECT_WORDS + 5) return { refused: 'too-long' };
    if (lyric !== undefined && runOf(lyricLines(lyric), text, SUBJECT_ECHO_WORDS) !== undefined) return { refused: 'quoted-lyric' };

    return { about: text };
}

/** A lyric as the lines the echo checks compare against. */
export const lyricLines = (lyric: string): string[] =>
    lyric
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0);
