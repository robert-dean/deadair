import type { LyricLine, LyricWord } from '@deadair/plugin-sdk';

/** `[mm:ss.xx]`, `[mm:ss.xxx]`, `[mm:ss]` and the `[mm:ss:xx]` some editors write. */
const TIMESTAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** A leading run of timestamps, which is how one sung line is repeated without being typed twice. */
const LEADING_TIMESTAMPS = /^(?:\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+/;

/** `[offset:+250]`, in milliseconds. Positive means the lyrics appear SOONER. */
const OFFSET_TAG = /^\s*\[offset:\s*([+-]?\d+)\s*\]\s*$/i;

/** Enhanced LRC's per-word timings, `<00:12.34>`, written in front of the word (or syllable) they start. */
const WORD_TIMESTAMP = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;

/**
 * A body that is ONLY an instrumental marker: LRC's `[au: instrumental]`, a lone "Instrumental",
 * bracketed or not. Anchored to the whole line, so a song that merely sings the word is not caught.
 */
const INSTRUMENTAL_LINE = /^\s*[[(]?\s*(?:au\s*:\s*)?instrumental\s*[)\]]?\s*$/i;

function toMs(minutes: string, seconds: string, fraction: string | undefined): number {
    // A fraction is read as the decimal it is written as: `.7` is 700ms, `.79` is 790, `.790` is 790.
    const millis = fraction === undefined ? 0 : Math.round(Number(`0.${fraction}`) * 1000);
    return Number(minutes) * 60_000 + Number(seconds) * 1000 + millis;
}

/**
 * A line body's per-word timings, as pieces whose texts joined are the body trimmed, or `undefined`
 * when the body carries none.
 *
 * Text in front of the first tag starts with the line, so it takes `lineMs`. A tag with nothing but
 * whitespace after it (an end marker, or a tag between two spaces) starts no word: the whitespace
 * joins the piece before it, so the pieces still join to the line exactly, which is what lets a
 * reader light a prefix of it.
 */
function wordsOf(body: string, lineMs: number): LyricWord[] | undefined {
    const pieces: LyricWord[] = [];
    let cursor = 0;
    let at = lineMs;
    let tagged = false;

    const add = (text: string) => {
        if (text.trim().length > 0) pieces.push({ atMs: at, text });
        else if (pieces.length > 0) pieces[pieces.length - 1]!.text += text;
    };

    for (const tag of body.matchAll(WORD_TIMESTAMP)) {
        add(body.slice(cursor, tag.index));
        at = toMs(tag[1]!, tag[2]!, tag[3]);
        cursor = tag.index + tag[0].length;
        tagged = true;
    }
    add(body.slice(cursor));

    if (!tagged || pieces.length === 0) return undefined;
    pieces[0]!.text = pieces[0]!.text.trimStart();
    pieces[pieces.length - 1]!.text = pieces[pieces.length - 1]!.text.trimEnd();
    return pieces;
}

/**
 * LRC text as timed lines, sorted by start.
 *
 * A line with several leading timestamps becomes one line per stamp. Metadata tags (`[ar:...]`,
 * `[ti:...]`) carry no timestamp of the right shape and are skipped, except `[offset:...]`, which is
 * applied: the effective start is `start - offset`, clamped at zero, because a positive offset
 * means the lyrics should appear sooner. A blank timed line is kept, since in LRC it marks where the
 * line before it stops being sung. No line here carries an `endMs`: LRC has none, and a guessed one
 * would be believed downstream.
 *
 * Enhanced LRC's `<mm:ss.xx>` word tags become the line's `words`, with the offset applied to them
 * too, and are taken out of its `text`. On a line stamped more than once they were typed against
 * the FIRST stamp, so each later copy has them moved by the same distance its own stamp is.
 */
export function parseLrc(text: string): LyricLine[] {
    let offset = 0;
    const lines: LyricLine[] = [];

    for (const raw of text.split(/\r?\n/)) {
        const offsetMatch = OFFSET_TAG.exec(raw);
        if (offsetMatch) {
            offset = Number(offsetMatch[1]);
            continue;
        }

        const leading = LEADING_TIMESTAMPS.exec(raw);
        if (!leading) continue;

        const body = raw.slice(leading[0].length);
        const text = body.replace(WORD_TIMESTAMP, '').trim();
        const stamps = [...leading[0].matchAll(TIMESTAMP)].map(stamp => toMs(stamp[1]!, stamp[2]!, stamp[3]));
        const words = wordsOf(body, stamps[0]!);
        for (const atMs of stamps) {
            const moved = atMs - stamps[0]!;
            lines.push(words ? { atMs, text, words: words.map(word => ({ atMs: word.atMs + moved, text: word.text })) } : { atMs, text });
        }
    }

    const shift = (atMs: number) => Math.max(0, atMs - offset);
    return lines
        .map(line => ({
            ...line,
            atMs: shift(line.atMs),
            ...(line.words ? { words: line.words.map(word => ({ atMs: shift(word.atMs), text: word.text })) } : {}),
        }))
        .sort((left, right) => left.atMs - right.atMs);
}

/** Whether every line that has words is an instrumental marker, which is a record nobody sings on. */
export function isInstrumentalBody(lines: readonly string[]): boolean {
    const sung = lines.map(line => line.trim()).filter(line => line.length > 0);
    return sung.length > 0 && sung.every(line => INSTRUMENTAL_LINE.test(line));
}
