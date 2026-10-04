// Where the singing is, from timed lyric lines. The cases come from #47's measurement of this
// station's own catalog: a first line at zero, under one second, under three, a blank line marking
// where singing stops, and a long gap that is a bridge rather than a held note.

import { describe, expect, it } from 'vitest';

import { LINE_CAP_MS, MIN_ONSET_MS, TAIL_MS, vocalMarkers, vocalRanges } from '../../../src/modules/lyrics/vocal.ranges.js';
import { runwayFor } from '../../../src/modules/lyrics/vocal.runway.js';

const line = (atMs: number, text = 'sung', endMs?: number) => ({ atMs, text, ...(endMs === undefined ? {} : { endMs }) });

describe('vocalRanges', () => {
    it('merges lines sung close together into one stretch', () => {
        expect(vocalRanges([line(10_000), line(13_000), line(16_000)])).toEqual([{ startMs: 10_000, endMs: 16_000 + TAIL_MS }]);
    });

    it('ends a line at a blank one, which is where LRC marks the singing stopping', () => {
        expect(vocalRanges([line(10_000), line(12_000, '')])).toEqual([{ startMs: 10_000, endMs: 12_000 }]);
    });

    it('caps a line before a long gap, so a solo reads as a break rather than a held note', () => {
        expect(vocalRanges([line(10_000), line(60_000)])).toEqual([
            { startMs: 10_000, endMs: 10_000 + LINE_CAP_MS },
            { startMs: 60_000, endMs: 60_000 + TAIL_MS },
        ]);
    });

    it('believes an end the source stated', () => {
        expect(vocalRanges([line(10_000, 'sung', 11_000), line(30_000)])).toEqual([
            { startMs: 10_000, endMs: 11_000 },
            { startMs: 30_000, endMs: 30_000 + TAIL_MS },
        ]);
    });

    it('reads lines out of order in time order', () => {
        expect(vocalRanges([line(16_000), line(10_000)])[0]?.startMs).toBe(10_000);
    });
});

describe('vocalMarkers', () => {
    it('gives the onset and the end of the singing', () => {
        expect(vocalMarkers([{ provider: 'a', instrumental: false, synced: [line(15_900), line(18_000), line(200_000)] }])).toEqual({
            kind: 'ranges',
            onsetMs: 15_900,
            endMs: 200_000 + TAIL_MS,
            ranges: [
                // The second line has a successor, so it runs toward it and is capped rather than given a tail.
                { startMs: 15_900, endMs: 18_000 + LINE_CAP_MS },
                { startMs: 200_000, endMs: 200_000 + TAIL_MS },
            ],
        });
    });

    it.each([0, 130, 900, MIN_ONSET_MS - 1])('reads a first line at %ims as a bad transcription, not a record with no intro', atMs => {
        expect(vocalMarkers([{ provider: 'a', instrumental: false, synced: [line(atMs), line(20_000)] }])).toEqual({ kind: 'unknown' });
    });

    it('takes a first line just under three seconds as real', () => {
        expect(vocalMarkers([{ provider: 'a', instrumental: false, synced: [line(2_900)] }])).toMatchObject({ kind: 'ranges', onsetMs: 2_900 });
    });

    it('says nothing about plain words with no timings', () => {
        expect(vocalMarkers([{ provider: 'a', instrumental: false }])).toEqual({ kind: 'unknown' });
    });

    it('ignores timed lines that are all blank', () => {
        expect(vocalMarkers([{ provider: 'a', instrumental: false, synced: [line(5_000, '')] }])).toEqual({ kind: 'unknown' });
    });

    it('lets a source with the singing timed outrank another calling the record instrumental', () => {
        expect(
            vocalMarkers([
                { provider: 'a', instrumental: true },
                { provider: 'b', instrumental: false, synced: [line(12_000)] },
            ]),
        ).toMatchObject({ kind: 'ranges', onsetMs: 12_000 });
    });

    it('stands on an instrumental when nobody has timings', () => {
        expect(vocalMarkers([{ provider: 'a', instrumental: true }])).toEqual({ kind: 'instrumental' });
    });

    it('takes the first source with timings, in the order it was given', () => {
        expect(
            vocalMarkers([
                { provider: 'a', instrumental: false, synced: [line(9_000)] },
                { provider: 'b', instrumental: false, synced: [line(12_000)] },
            ]),
        ).toMatchObject({ onsetMs: 9_000 });
    });
});

describe('runwayFor', () => {
    const at = (onsetMs: number) => ({ kind: 'ranges' as const, onsetMs, endMs: onsetMs + 60_000, ranges: [] });

    it('moves the onset onto the timeline the record airs on, past its trimmed lead-in', () => {
        expect(runwayFor(at(8_000), 6_000)).toEqual({ kind: 'ms', ms: 2_000 });
    });

    it('leaves the onset alone for a record that airs from the top of the file', () => {
        expect(runwayFor(at(8_000))).toEqual({ kind: 'ms', ms: 8_000 });
        expect(runwayFor(at(8_000), 0)).toEqual({ kind: 'ms', ms: 8_000 });
    });

    it('reads a vocal at or before the cue-in as no runway at all, never a negative one', () => {
        expect(runwayFor(at(3_000), 4_000)).toEqual({ kind: 'ms', ms: 0 });
    });

    it('passes the other two states through intact', () => {
        expect(runwayFor({ kind: 'instrumental' }, 6_000)).toEqual({ kind: 'instrumental' });
        expect(runwayFor({ kind: 'unknown' }, 6_000)).toEqual({ kind: 'unknown' });
    });
});
