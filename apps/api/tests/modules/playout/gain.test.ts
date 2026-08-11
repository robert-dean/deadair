// The two ways of being wrong here are not symmetrical, and every case below is
// one of them. Refusing to gain a record leaves the station where it already is.
// Boosting one past its headroom clips it on the way out of the encoder, and
// nothing in the file looks wrong afterwards.

import { describe, expect, it } from 'vitest';

import { CEILING_DBTP, MAX_GAIN_DB, MIN_GAIN_DB, TRUE_PEAK_ALLOWANCE_DB, gainFor } from '../../../src/modules/playout/gain.js';

const TARGET = -16;

describe('gainFor', () => {
    it('lifts a quiet master to the target', () => {
        // -20 LUFS with 6 dB of headroom: the whole 4 dB fits under the ceiling.
        expect(gainFor({ loudnessLufs: -20, truePeakDb: -6 }, TARGET)).toBe(4);
    });

    it('pulls a loud master down to the target', () => {
        expect(gainFor({ loudnessLufs: -9, truePeakDb: -0.2 }, TARGET)).toBe(-7);
    });

    it('caps a boost at the headroom the master actually has', () => {
        // Wants +6, has 2.5 dB to the ceiling. A modern master runs hot enough that
        // this is the ordinary case rather than the edge one.
        expect(gainFor({ loudnessLufs: -22, truePeakDb: -3.5 }, TARGET)).toBe(2.5);
    });

    it('refuses to boost a master that is already over the ceiling', () => {
        // Above 0 dBTP is legitimate and common: it means the master overshoots on
        // playback already. Nothing is added, and nothing is subtracted either --
        // the peak does not get a vote on cuts.
        expect(gainFor({ loudnessLufs: -18, truePeakDb: 0.8 }, TARGET)).toBeUndefined();
    });

    it('never caps a cut, however hot the peak', () => {
        // Turning a record down cannot clip it, so the headroom check has no part in it.
        expect(gainFor({ loudnessLufs: -8, truePeakDb: 1.5 }, TARGET)).toBe(-8);
    });

    it('treats a sample peak as optimistic when no true peak was measured', () => {
        // -4 dBFS sampled is assumed to reconstruct at -3, leaving 2 dB to the ceiling,
        // so the 5 dB this record wants is cut to that.
        const gain = gainFor({ loudnessLufs: -21, samplePeakDb: -4 }, TARGET);

        expect(gain).toBe(CEILING_DBTP - (-4 + TRUE_PEAK_ALLOWANCE_DB));
        expect(gain).toBe(2);
    });

    it('prefers the true peak where both were measured', () => {
        // The sample peak would allow 4 dB; the true peak allows 2, and it is the one
        // that describes what the decoder will produce.
        expect(gainFor({ loudnessLufs: -21, truePeakDb: -3, samplePeakDb: -5 }, TARGET)).toBe(2);
    });

    it('refuses a boost when there is no peak at all, and still allows a cut', () => {
        expect(gainFor({ loudnessLufs: -21 }, TARGET)).toBeUndefined();
        expect(gainFor({ loudnessLufs: -10 }, TARGET)).toBe(-6);
    });

    it('bounds a measurement that cannot be right', () => {
        // A near-silent decode -- a preview clip, an error page, a truncated transfer --
        // asks for tens of decibels with complete confidence. It gets twelve.
        expect(gainFor({ loudnessLufs: -60, truePeakDb: -40 }, TARGET)).toBe(MAX_GAIN_DB);
        expect(gainFor({ loudnessLufs: 6, truePeakDb: 3 }, TARGET)).toBe(-MAX_GAIN_DB);
    });

    it('says nothing about a record that is already where it should be', () => {
        expect(gainFor({ loudnessLufs: -16, truePeakDb: -1.5 }, TARGET)).toBeUndefined();
        expect(gainFor({ loudnessLufs: -16.4, truePeakDb: -1.5 }, TARGET)).toBeUndefined();
    });

    it('stamps the smallest correction worth making', () => {
        expect(gainFor({ loudnessLufs: -16.5, truePeakDb: -6 }, TARGET)).toBe(MIN_GAIN_DB);
        expect(gainFor({ loudnessLufs: -15.5, truePeakDb: -6 }, TARGET)).toBe(-MIN_GAIN_DB);
    });

    it('rounds to a tenth of a decibel', () => {
        expect(gainFor({ loudnessLufs: -18.37, truePeakDb: -6 }, TARGET)).toBe(2.4);
    });

    it('says nothing about a track nothing measured', () => {
        // The ordinary state, and never a fault: an unmeasured track has to play.
        expect(gainFor({}, TARGET)).toBeUndefined();
        expect(gainFor({ truePeakDb: -3, samplePeakDb: -4 }, TARGET)).toBeUndefined();
    });

    it('says nothing rather than throwing on a blob holding the wrong shape', () => {
        // `data` is jsonb a plugin wrote and the host stores unread, so a string and a
        // NaN are both reachable from here.
        expect(gainFor({ loudnessLufs: '-14' as unknown as number, truePeakDb: -3 }, TARGET)).toBeUndefined();
        expect(gainFor({ loudnessLufs: Number.NaN, truePeakDb: -3 }, TARGET)).toBeUndefined();
        expect(gainFor({ loudnessLufs: -20, truePeakDb: Number.POSITIVE_INFINITY }, TARGET)).toBeUndefined();
        expect(gainFor({ loudnessLufs: -20, truePeakDb: -6 }, Number.NaN)).toBeUndefined();
    });
});
