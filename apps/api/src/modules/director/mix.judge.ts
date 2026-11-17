import { createHash } from 'node:crypto';
import type { LlmMessage } from '@deadair/plugin-sdk';
import { firstJsonObject } from '#modules/shared/json.objects.js';

/**
 * A yes-or-no question a show's mix flow asks about one record, as the station's model answers it.
 *
 * Pure: the prompt, the parse and the version. The walk that runs it is `MixJudgeService`.
 */

const SYSTEM = [
    'You answer one yes-or-no question about one record for a radio station, the way a well-read music fan would.',
    'Judge the record itself: the song, the artist and what the record is known for.',
    'If you do not know the record well enough to answer, say so rather than guessing.',
    '',
    'Answer with a JSON object and nothing else: {"answer": true}, {"answer": false} or {"unknown": true}.',
].join('\n');

/** Changes when the instructions do. Kept with each answer to say which instructions gave it; an answer is not asked again when it changes. */
export const MIX_JUDGE_VERSION = createHash('sha256').update(SYSTEM).digest('hex').slice(0, 12);

export interface JudgeSubject {
    question: string;
    title: string;
    artist: string;
}

export function mixJudgePrompt(subject: JudgeSubject, canSearch: boolean): LlmMessage[] {
    const lines = [`The record is "${subject.title}" by ${subject.artist}.`, '', `The question: ${subject.question}`];
    if (canSearch) lines.push('', 'You can search the web about the record before you answer.');
    return [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: lines.join('\n') },
    ];
}

/** True or false, `unknown`, or `undefined` for an answer that is none of them. */
export function readMixJudgement(answer: string): boolean | 'unknown' | undefined {
    const parsed = firstJsonObject(answer);
    if (parsed === undefined) return undefined;
    if (parsed.unknown === true) return 'unknown';
    return typeof parsed.answer === 'boolean' ? parsed.answer : undefined;
}
