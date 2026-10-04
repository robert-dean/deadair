import type { LyricLine, TrackLyrics } from '@deadair/plugin-sdk';

/**
 * The longest plain lyric kept, in characters.
 *
 * A lyric sits between enrichment's `MAX_TEXT` (2,000) and `MAX_BIOGRAPHY` (20,000), which is one of
 * the reasons it is not an enrichment field. This bounds a plugin that hands over a whole page by
 * mistake; a real lyric is a few thousand characters.
 */
export const MAX_LYRIC_TEXT = 20_000;

/** The most timed lines kept. A long song is around a hundred; past this the source is not a lyric. */
export const MAX_LYRIC_LINES = 1_000;

/** The longest single timed line kept, in characters. */
export const MAX_LYRIC_LINE_TEXT = 500;

/** A BCP 47 tag, loosely: a primary language and optional subtags. Anything else is dropped rather than stored. */
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;

/**
 * What one plugin's answer about one record amounts to, once it is safe to store.
 *
 * Three answers and not two, because an instrumental is neither a miss nor words: a source saying
 * nobody sings on a record has answered the question, and the walk stops asking.
 */
export type SanitizedLyrics =
    | { kind: 'words'; plain?: string; synced?: LyricLine[]; language?: string; providerRef?: string }
    | { kind: 'instrumental'; providerRef?: string }
    | { kind: 'miss' };

const isNonNegativeMs = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function cleanLine(line: unknown): LyricLine | undefined {
    if (typeof line !== 'object' || line === null) return undefined;
    const { atMs, endMs, text } = line as Partial<LyricLine>;
    if (!isNonNegativeMs(atMs) || typeof text !== 'string') return undefined;

    const at = Math.round(atMs);
    const cleaned: LyricLine = { atMs: at, text: text.trim().slice(0, MAX_LYRIC_LINE_TEXT) };
    // An end before the start is a source's mistake, and keeping it would be believed by whatever
    // derives a range from it. Dropped, so the host falls back to the next line's start.
    if (isNonNegativeMs(endMs) && endMs >= at) cleaned.endMs = Math.round(endMs);
    return cleaned;
}

/**
 * One plugin's answer, made storable, or `miss` when nothing usable is left.
 *
 * The timed lines are SORTED by start: a source listing them out of order is common enough with
 * hand-edited LRC, and every reader downstream assumes the order. Empty-text lines are kept, because
 * in LRC a blank timed line marks where the line before it stops being sung.
 *
 * `instrumental` wins over any words that came with it, for the database's own reason: a row cannot
 * claim both, and a source that says nobody sings is the stronger claim.
 */
export function sanitizeLyrics(answer: TrackLyrics | undefined, warn: (reason: string) => void = () => {}): SanitizedLyrics {
    if (typeof answer !== 'object' || answer === null) return { kind: 'miss' };

    const providerRef = typeof answer.providerRef === 'string' && answer.providerRef.trim() ? answer.providerRef.trim().slice(0, 500) : undefined;

    if (answer.instrumental === true) {
        if (answer.plain || answer.synced?.length) warn('an instrumental arrived with words, which were dropped');
        return { kind: 'instrumental', ...(providerRef ? { providerRef } : {}) };
    }

    let plain = typeof answer.plain === 'string' ? answer.plain.trim() : '';
    if (plain.length > MAX_LYRIC_TEXT) {
        warn(`plain lyric of ${plain.length} characters cut to ${MAX_LYRIC_TEXT}`);
        plain = plain.slice(0, MAX_LYRIC_TEXT);
    }

    const raw = Array.isArray(answer.synced) ? answer.synced : [];
    const lines = raw.map(cleanLine).filter((line): line is LyricLine => line !== undefined);
    if (lines.length < raw.length) warn(`${raw.length - lines.length} timed lines were unusable and dropped`);
    if (lines.length > MAX_LYRIC_LINES) warn(`${lines.length} timed lines cut to ${MAX_LYRIC_LINES}`);
    const synced = lines.sort((left, right) => left.atMs - right.atMs).slice(0, MAX_LYRIC_LINES);

    // A synced body whose every line is blank carries timings and no words, which is no lyric.
    const hasSyncedWords = synced.some(line => line.text.length > 0);
    if (!plain && !hasSyncedWords) return { kind: 'miss' };

    const language = typeof answer.language === 'string' && LANGUAGE_TAG.test(answer.language) ? answer.language : undefined;

    return {
        kind: 'words',
        ...(plain ? { plain } : {}),
        ...(hasSyncedWords ? { synced } : {}),
        ...(language ? { language } : {}),
        ...(providerRef ? { providerRef } : {}),
    };
}
