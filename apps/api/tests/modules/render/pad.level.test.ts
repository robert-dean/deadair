// A pad is mastered by whoever made it, so mixing every one at 0 dB put each wherever its maker left
// it. These pin the subtraction that replaces that and the two places it deliberately says nothing.

import { describe, expect, it } from 'vitest';

import { padGainDb } from '../../../src/modules/render/pad.level.js';
import { ASSUMED_SPEECH_LUFS, MAX_GAIN_DB } from '../../../src/modules/playout/gain.js';

describe('padGainDb', () => {
    it('puts a measured pad the asked-for distance from the assumed speech level', () => {
        // Six under speech assumed at -26.5 is -32.5; a pad at -30 comes down two and a half.
        expect(padGainDb(-30, -6)).toBe(ASSUMED_SPEECH_LUFS - 6 - -30);
        expect(padGainDb(-30, -6)).toBe(-2.5);
    });

    it('lifts a pad quieter than where it belongs, since the mixer cannot clip a sum', () => {
        expect(padGainDb(-40, -6)).toBe(7.5);
    });

    it('says nothing about a pad nobody measured', () => {
        // Most short pads: integrated loudness is gated in 400ms blocks, so a rimshot has no figure.
        expect(padGainDb(undefined, -6)).toBeUndefined();
        expect(padGainDb(Number.NaN, -6)).toBeUndefined();
    });

    it('says nothing about a correction too small to hear', () => {
        expect(padGainDb(-32.3, -6)).toBeUndefined();
    });

    it('clamps a wild figure, which is a measurement of the wrong file rather than a loud pad', () => {
        expect(padGainDb(0, -6)).toBe(-MAX_GAIN_DB);
        expect(padGainDb(-80, -6)).toBe(MAX_GAIN_DB);
    });

    it('rounds to a tenth of a decibel', () => {
        expect(padGainDb(-29.123, -6)).toBe(-3.4);
    });
});
