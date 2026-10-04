import type { LyricLine } from '@deadair/plugin-sdk';

/**
 * When a record is being sung, read off its timed lyric lines.
 *
 * The argument is [track-lyrics](https://github.com/robert-dean/deadair/discussions/47) § "The shape
 * of the answer is a pair of markers, not a number". A synced lyric is a timestamp somebody typed
 * while listening, so it says when the singing starts and stops with no decoder and no model. The
 * trade calls the pair the post and the end of the vocal, and talks up to the first.
 *
 * Everything here is pure, and nothing is stored: the ranges are a function of the lines, cheap to
 * recompute, and they move when the constants below are tuned, so a stored copy would only go stale.
 */

/** One stretch of singing, in milliseconds from the start of the recording. */
export interface VocalRange {
    startMs: number;
    endMs: number;
}

/**
 * Sung lines closer together than this are one stretch of singing; a wider gap splits them, which is
 * what exposes a solo or a bridge. The value a comparable station has shown to work.
 */
export const MERGE_GAP_MS = 8_000;

/** A line runs to the next line's start, but no longer than this, so a long gap reads as a break rather than as one held note. */
export const LINE_CAP_MS = 8_000;

/** The last sung line has no successor, so it is given this nominal tail. */
export const TAIL_MS = 4_000;

/**
 * A first sung line earlier than this is read as a bad transcription rather than a record with no intro.
 *
 * Measured across 52 synced lyrics for this station's own records: the first sung line sits at a
 * median of 15.9s, but 12 of 52 are under three seconds and 6 under one, one at exactly zero. Some
 * are true. Others are a transcriber timing the title card, or a line timed early so a singer can
 * follow it. Taken at face value, a quarter of the library would get no talk-up at all; refused, the
 * record falls back to what the station does without lyrics, which is the safe direction.
 */
export const MIN_ONSET_MS = 2_000;

/**
 * Where the singing is, as a tri-state.
 *
 * - `instrumental`: a source says nobody sings on it, so there is nothing to talk over.
 * - `ranges`: when the singing starts (`onsetMs`), when it stops (`endMs`), and the stretches between.
 * - `unknown`: plain words with no timings, no lyric at all, or a first line too early to believe.
 *   This is "cannot say", and every reader must treat it as "do what you did before", never as zero.
 */
export type VocalMarkers = { kind: 'instrumental' } | { kind: 'ranges'; onsetMs: number; endMs: number; ranges: VocalRange[] } | { kind: 'unknown' };

export const UNKNOWN_MARKERS: VocalMarkers = { kind: 'unknown' };

const isSung = (line: LyricLine): boolean => line.text.trim().length > 0;

/**
 * The stretches of singing in a set of timed lines.
 *
 * A sung line ends at its own `endMs` when the source stated one, otherwise at the next line's
 * start, blank lines included, since in LRC a blank timed line is exactly where singing stops. Either
 * way it is capped at {@link LINE_CAP_MS}. The last sung line, with no successor, gets {@link TAIL_MS}.
 */
export function vocalRanges(lines: readonly LyricLine[]): VocalRange[] {
    const sorted = [...lines].sort((left, right) => left.atMs - right.atMs);
    const ranges: VocalRange[] = [];

    sorted.forEach((line, index) => {
        if (!isSung(line)) return;

        const start = line.atMs;
        const next = sorted.slice(index + 1).find(candidate => candidate.atMs > start);
        const stated = line.endMs !== undefined && line.endMs > start ? line.endMs : undefined;
        const end = Math.min(stated ?? next?.atMs ?? start + TAIL_MS, start + LINE_CAP_MS);

        const last = ranges[ranges.length - 1];
        if (last && start - last.endMs <= MERGE_GAP_MS) {
            last.endMs = Math.max(last.endMs, end);
        } else {
            ranges.push({ startMs: start, endMs: end });
        }
    });

    return ranges;
}

/** What one stored lyric row says about timing. The words are needed only to tell a sung line from a blank one. */
export interface LyricTiming {
    provider: string;
    instrumental: boolean;
    synced?: LyricLine[];
}

/**
 * The markers for one record, from every source that answered about it.
 *
 * `rows` arrive in the order their sources should be believed. The first row with sung, timed lines
 * decides, because a timing is evidence and a flag is a claim: a source with the singing timed
 * outranks another calling the record instrumental. Only when nobody has timings does an
 * instrumental answer stand. Anything else is `unknown`.
 */
export function vocalMarkers(rows: readonly LyricTiming[]): VocalMarkers {
    for (const row of rows) {
        const lines = row.synced ?? [];
        if (!lines.some(isSung)) continue;

        const ranges = vocalRanges(lines);
        const first = ranges[0];
        const last = ranges[ranges.length - 1];
        if (!first || !last) continue;
        if (first.startMs < MIN_ONSET_MS) return UNKNOWN_MARKERS;

        return { kind: 'ranges', onsetMs: first.startMs, endMs: last.endMs, ranges };
    }

    return rows.some(row => row.instrumental) ? { kind: 'instrumental' } : UNKNOWN_MARKERS;
}
