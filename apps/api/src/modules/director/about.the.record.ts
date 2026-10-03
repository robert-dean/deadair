/**
 * Telling the presenter what a record is about.
 *
 * The station's model writes one sentence per record from its lyric (`lyrics/lyric.subject.ts`, with
 * `lyrics.subjects`). This switch is the other half: whether a talk link's writer is SHOWN those
 * sentences. Separate, and off, because the first only stores words and this one puts them in front
 * of something that speaks. With it on the writer is also guarded against the lyric itself: the
 * records' own lines ride the request for `AnswerGuard.lyrics`, never the prompt, and a script that
 * quotes six words of one in a row is refused.
 */
export const ABOUT_THE_RECORD_KEYS = {
    enabled: 'breaks.aboutTheRecord',
} as const;

export const ABOUT_THE_RECORD_DEFAULT = false;
