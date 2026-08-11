// The rule every case here is really testing is the one that cannot be got wrong
// quietly: a blend is never longer than the shorter of the two measurements, so it
// can never eat a cold opening. Everything else degrades to zero, which is the
// hard join the station made before any of this existed.

import { describe, expect, it } from 'vitest';

import { MAX_BLEND_MS, MIN_BLEND_MS, blendFor, type MeasuredCuePoints } from '../../../src/modules/playout/crossfade.js';

const BLENDING = { crossfade: true };

/** A record described by the two lengths that matter, rather than by four offsets. */
const record = (introMs: number, outroMs: number): MeasuredCuePoints => ({
    cueInMs: 1_000,
    introEndMs: 1_000 + introMs,
    outroStartMs: 200_000,
    cueOutMs: 200_000 + outroMs,
});

describe('blendFor', () => {
    it('rides the shorter of the two measurements', () => {
        // A ten second fade into an eight second intro is an eight second blend. The
        // outgoing record has more ending to give than the incoming one can absorb.
        expect(blendFor(record(0, 10_000), record(8_000, 0), BLENDING)).toBe(8_000);
    });

    it('never eats a cold opening, however long the fade', () => {
        // The rule the whole design exists for. A record that starts on the downbeat
        // has no intro to blend into, so a thirty second fade is not ridden at all.
        expect(blendFor(record(0, 30_000), record(0, 0), BLENDING)).toBe(0);
    });

    it('barely rides a record that ends cold, however long the next intro', () => {
        // The other half of the same rule, and the reason this is measured rather than
        // set: a cold ending is a decision the record made.
        expect(blendFor(record(0, 200), record(20_000, 0), BLENDING)).toBe(0);
    });

    it('holds a long pair at the ceiling', () => {
        expect(blendFor(record(0, 40_000), record(40_000, 0), BLENDING)).toBe(MAX_BLEND_MS);
    });

    it('takes a pair that measures exactly at either bound', () => {
        expect(blendFor(record(0, MIN_BLEND_MS), record(MIN_BLEND_MS, 0), BLENDING)).toBe(MIN_BLEND_MS);
        expect(blendFor(record(0, MAX_BLEND_MS), record(MAX_BLEND_MS, 0), BLENDING)).toBe(MAX_BLEND_MS);
    });

    it('refuses a blend nobody could hear as one', () => {
        // Not a shorter blend: a buffer spent for nothing, and the buffer is what puts
        // the voice-cue clock ahead of the audience.
        expect(blendFor(record(0, MIN_BLEND_MS - 1), record(20_000, 0), BLENDING)).toBe(0);
    });

    it('does not blend when the broadcast does not', () => {
        // An album played in full, or a setlist somebody sequenced. Its gaps are a
        // decision, and overlapping two of its tracks overrules it.
        expect(blendFor(record(0, 10_000), record(8_000, 0), { crossfade: false })).toBe(0);
    });

    it('does not blend into nothing', () => {
        // The tail of what has been planned. There is no boundary to size.
        expect(blendFor(record(0, 10_000), undefined, BLENDING)).toBe(0);
    });

    it('does not blend when either side is unmeasured', () => {
        // Which covers every segment: an ident carries no cue points, so a record
        // hands over to the station's own voice exactly as it does today.
        expect(blendFor({}, record(8_000, 0), BLENDING)).toBe(0);
        expect(blendFor(record(0, 10_000), {}, BLENDING)).toBe(0);
        expect(blendFor({}, {}, BLENDING)).toBe(0);
    });

    it('does not blend on a half-measured pair', () => {
        // The item carries all four points or none, so this should be unreachable.
        // It is checked anyway: these are read off a jsonb blob two layers up, and a
        // type is not a guarantee about a row.
        expect(blendFor({ outroStartMs: 190_000 }, record(8_000, 0), BLENDING)).toBe(0);
        expect(blendFor(record(0, 10_000), { cueInMs: 0 }, BLENDING)).toBe(0);
    });

    it('reads a length that runs backwards as no length, not a negative one', () => {
        // A negative duration would reach Liquidsoap as a `cross` sized below zero.
        // Clamped rather than rejected, because the pair is still measured and the
        // honest reading of an outro that ends before it starts is that there is none.
        const backwards: MeasuredCuePoints = { cueInMs: 5_000, introEndMs: 1_000, outroStartMs: 200_000, cueOutMs: 190_000 };

        expect(blendFor(backwards, record(8_000, 0), BLENDING)).toBe(0);
        expect(blendFor(record(0, 10_000), backwards, BLENDING)).toBe(0);
    });

    it('measures the intro from cue_in rather than from the head of the file', () => {
        // A record with two seconds of leading silence and an intro ending at ten is
        // underway eight seconds after the listener hears anything, and eight is the
        // number to blend for. The trim has already removed the silence.
        const leadingSilence: MeasuredCuePoints = { cueInMs: 2_000, introEndMs: 10_000, outroStartMs: 200_000, cueOutMs: 200_000 };

        expect(blendFor(record(0, 30_000), leadingSilence, BLENDING)).toBe(8_000);
    });

    it('measures the outro to cue_out rather than to the end of the file', () => {
        // The same argument at the other end: trailing silence is trimmed, so an outro
        // that runs to a cue_out well before the file ends is the length that is heard.
        const trailingSilence: MeasuredCuePoints = { cueInMs: 0, introEndMs: 0, outroStartMs: 180_000, cueOutMs: 186_000 };

        expect(blendFor(trailingSilence, record(30_000, 0), BLENDING)).toBe(6_000);
    });
});
