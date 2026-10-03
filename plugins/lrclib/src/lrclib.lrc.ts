import type { LyricLine } from '@deadair/plugin-sdk';

/** `[mm:ss.xx]`, `[mm:ss.xxx]`, `[mm:ss]` and the `[mm:ss:xx]` some editors write. */
const TIMESTAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** A leading run of timestamps, which is how one sung line is repeated without being typed twice. */
const LEADING_TIMESTAMPS = /^(?:\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+/;

/** `[offset:+250]`, in milliseconds. Positive means the lyrics appear SOONER. */
const OFFSET_TAG = /^\s*\[offset:\s*([+-]?\d+)\s*\]\s*$/i;

/** Enhanced LRC's per-word timings, `<00:12.34>`, which are dropped: a line's own start is what is kept. */
const WORD_TIMESTAMP = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;

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
 * LRC text as timed lines, sorted by start.
 *
 * A line with several leading timestamps becomes one line per stamp. Metadata tags (`[ar:...]`,
 * `[ti:...]`) carry no timestamp of the right shape and are skipped, except `[offset:...]`, which is
 * applied: the effective start is `start - offset`, clamped at zero, because a positive offset
 * means the lyrics should appear sooner. A blank timed line is kept, since in LRC it marks where the
 * line before it stops being sung. No line here carries an `endMs`: LRC has none, and a guessed one
 * would be believed downstream.
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

        const words = raw.slice(leading[0].length).replace(WORD_TIMESTAMP, '').trim();
        for (const stamp of leading[0].matchAll(TIMESTAMP)) {
            lines.push({ atMs: toMs(stamp[1]!, stamp[2]!, stamp[3]), text: words });
        }
    }

    return lines.map(line => ({ ...line, atMs: Math.max(0, line.atMs - offset) })).sort((left, right) => left.atMs - right.atMs);
}

/** Whether every line that has words is an instrumental marker, which is a record nobody sings on. */
export function isInstrumentalBody(lines: readonly string[]): boolean {
    const sung = lines.map(line => line.trim()).filter(line => line.length > 0);
    return sung.length > 0 && sung.every(line => INSTRUMENTAL_LINE.test(line));
}
