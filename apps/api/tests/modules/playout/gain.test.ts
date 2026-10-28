// The two ways of being wrong here are not symmetrical, and every case below is
// one of them. Refusing to gain a record leaves the station where it already is.
// Boosting one past its headroom clips it on the way out of the encoder, and
// nothing in the file looks wrong afterwards.

import { describe, expect, it } from 'vitest';

import {
    ASSUMED_PROGRAMME_LUFS,
    ASSUMED_SPEECH_LUFS,
    CEILING_DBTP,
    MAX_GAIN_DB,
    MAX_SPEECH_GAIN_DB,
    MIN_GAIN_DB,
    DEFAULT_SPEECH_TRIM_DB,
    DEFAULT_TARGET_LUFS,
    DEFAULT_DUCK_DEEPEST_DB,
    DEFAULT_DUCK_SHALLOWEST_DB,
    DEFAULT_DUCK_UNDER_VOICE_DB,
    DUCK_DEEPEST_RANGE,
    DUCK_SHALLOWEST_RANGE,
    DUCK_UNDER_VOICE_RANGE,
    duckBedLufsFor,
    resolveDuck,
    MAX_SPEECH_TRIM_DB,
    MIN_SPEECH_TRIM_DB,
    resolveSpeechTrimDb,
    speechAimLufs,
    TRUE_PEAK_ALLOWANCE_DB,
    gainFor,
    programmeGainFor,
    speechGainFor,
} from '../../../src/modules/playout/gain.js';

const TARGET = -16;
const TRIM = DEFAULT_SPEECH_TRIM_DB;

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

// The asymmetry above is inverted here, which is the whole reason this is a second function.
// Refusing to gain a BREAK does not leave the station where it is: it puts the station's own
// voice several decibels under the records either side of it, on every break, which is the one
// failure a listener attributes to the station rather than to a record.
describe('speechGainFor', () => {
    it('lifts an unmeasured break from the assumed speech level', () => {
        // Where an unmeasured record is left alone. A break came out of a speech engine, and
        // what those produce is knowable in advance and consistently low.
        expect(speechGainFor({}, TARGET, TRIM)).toBe(TARGET - TRIM - ASSUMED_SPEECH_LUFS);
        expect(speechGainFor({}, TARGET, TRIM)).toBeGreaterThan(0);
    });

    it('uses the measurement once there is one', () => {
        expect(speechGainFor({ loudnessLufs: -24 }, TARGET, TRIM)).toBe(6);
        expect(speechGainFor({ loudnessLufs: -12 }, TARGET, TRIM)).toBe(-6);
    });

    it('aims a break under the target the records sit at, never level with it', () => {
        // A gated average says they are the same loudness and the ear does not: speech against
        // music at one integrated level arrives on top of it.
        expect(speechGainFor({ loudnessLufs: TARGET }, TARGET, TRIM)).toBe(-TRIM);
        expect(TRIM).toBeGreaterThan(0);
    });

    it('does not cap the boost against the peak', () => {
        // The difference from `gainFor`, and deliberate: this audio is the station's own, its
        // peaks are plosives rather than a master, and the bus limiter at -1 dBFS is downstream.
        // A record with these numbers would be held to +8 by its own headroom.
        expect(speechGainFor({ loudnessLufs: -28, truePeakDb: -9 }, TARGET, TRIM)).toBe(10);
        expect(gainFor({ loudnessLufs: -28, truePeakDb: -9 }, TARGET)).toBe(CEILING_DBTP + 9);
    });

    it('always answers, so a break can never inherit the last one', () => {
        // Nothing here may be undefined: the stamp is the only thing holding a break's level,
        // and Liquidsoap's override persisting across pushes is not a thing worth depending on.
        expect(speechGainFor({ loudnessLufs: TARGET - TRIM }, TARGET, TRIM)).toBe(0);
        expect(speechGainFor({ loudnessLufs: -18.4 }, TARGET, TRIM)).toBe(0.4);
    });

    it('bounds a measurement that cannot be right, and a target that is not one', () => {
        expect(speechGainFor({ loudnessLufs: -70 }, TARGET, TRIM)).toBe(MAX_SPEECH_GAIN_DB);
        expect(speechGainFor({ loudnessLufs: 12 }, TARGET, TRIM)).toBe(-MAX_SPEECH_GAIN_DB);
        // A settings row holding nonsense still has to produce a break at a sane level, and the
        // level it falls back to is the station's DEFAULT target rather than this file's fixture
        // one: `TARGET` here is a number chosen to make the arithmetic above readable, where an
        // unreadable settings row is exactly the case `DEFAULT_TARGET_LUFS` exists to answer.
        expect(speechGainFor({}, Number.NaN, TRIM)).toBe(DEFAULT_TARGET_LUFS - TRIM - ASSUMED_SPEECH_LUFS);
        expect(speechGainFor({ loudnessLufs: '-24' as unknown as number }, TARGET, TRIM)).toBe(TARGET - TRIM - ASSUMED_SPEECH_LUFS);
    });
});

describe('the speech cap', () => {
    it('lets the quietest engine measured reach the default target with no trim', () => {
        // Measured on the live station on 2026-10-05: segments at -25.5 to -28.3 LUFS, a trim of zero,
        // and the record cap of twelve holding every break 0.8 to 1.5 dB short of where it was aimed.
        expect(speechGainFor({ loudnessLufs: -28.3 }, DEFAULT_TARGET_LUFS, 0)).toBe(DEFAULT_TARGET_LUFS + 28.3);
        expect(DEFAULT_TARGET_LUFS + 28.3).toBeGreaterThan(MAX_GAIN_DB);
    });

    it("leaves somebody else's programme under the record cap, since that is a mastered level", () => {
        expect(programmeGainFor({ loudnessLufs: -40, truePeakDb: -30 }, DEFAULT_TARGET_LUFS, 0)).toBe(MAX_GAIN_DB);
        expect(programmeGainFor({ loudnessLufs: -40 }, DEFAULT_TARGET_LUFS, 0, 'station')).toBe(MAX_GAIN_DB);
    });
});

describe('speechAimLufs', () => {
    it('is the target less the trim, which is what a break is levelled to', () => {
        expect(speechAimLufs(TARGET, TRIM)).toBe(TARGET - TRIM);
        expect(speechGainFor({ loudnessLufs: speechAimLufs(TARGET, TRIM) }, TARGET, TRIM)).toBe(0);
    });

    it('falls back to the defaults for a figure that is not a number', () => {
        expect(speechAimLufs(Number.NaN, Number.NaN)).toBe(DEFAULT_TARGET_LUFS - DEFAULT_SPEECH_TRIM_DB);
    });
});

// Taste, unlike everything else in this file, which is measured or is a bound on being wrong. So it
// is a settings row, and a settings row is a string an operator typed.
describe('resolveSpeechTrimDb', () => {
    it('takes a number, however it was stored', () => {
        expect(resolveSpeechTrimDb(4)).toBe(4);
        expect(resolveSpeechTrimDb('4')).toBe(4);
        expect(resolveSpeechTrimDb('3.5')).toBe(3.5);
    });

    it('answers the default for anything that is not one', () => {
        expect(resolveSpeechTrimDb(undefined)).toBe(DEFAULT_SPEECH_TRIM_DB);
        expect(resolveSpeechTrimDb('')).toBe(DEFAULT_SPEECH_TRIM_DB);
        expect(resolveSpeechTrimDb('quieter please')).toBe(DEFAULT_SPEECH_TRIM_DB);
    });

    it('allows a negative trim, which is a DJ over the music', () => {
        // A station may legitimately want that, and refusing it would be this file holding an
        // opinion about a station's sound rather than about being wrong.
        expect(resolveSpeechTrimDb(-3)).toBe(-3);
    });

    it('clamps rather than rejecting, because nothing here is worth silence', () => {
        expect(resolveSpeechTrimDb(90)).toBe(MAX_SPEECH_TRIM_DB);
        expect(resolveSpeechTrimDb(-90)).toBe(MIN_SPEECH_TRIM_DB);
    });
});

// An episode of somebody else's programme: spoken word, so it belongs where the station's voice does,
// but mastered, so it is not assumed to be as quiet as a speech engine.
describe('programmeGainFor', () => {
    it("assumes a mastered level for an unmeasured episode, not the speech engine's", () => {
        // A cut needs no peak, so an aim under the assumed level is reached in full.
        const LOW_TARGET = -20;
        expect(programmeGainFor({}, LOW_TARGET, TRIM)).toBe(LOW_TARGET - TRIM - ASSUMED_PROGRAMME_LUFS);
        // Where the speech-engine assumption would have turned it up by more than eleven decibels.
        expect(programmeGainFor({}, DEFAULT_TARGET_LUFS, TRIM)).toBeLessThan(speechGainFor({}, DEFAULT_TARGET_LUFS, TRIM) - 10);
    });

    it('uses the measurement once there is one, exactly as a break does, where the headroom allows', () => {
        expect(programmeGainFor({ loudnessLufs: -24, truePeakDb: -12 }, TARGET, TRIM)).toBe(speechGainFor({ loudnessLufs: -24 }, TARGET, TRIM));
    });

    it('is bounded by the same cap', () => {
        expect(programmeGainFor({ loudnessLufs: -70, truePeakDb: -60 }, TARGET, TRIM)).toBe(MAX_GAIN_DB);
    });

    // Somebody else's master, so a boost is held under its peak exactly as a record's is. Without this
    // a quiet episode was lifted up to the record cap into the limiter, for its whole length.
    describe("somebody else's programme", () => {
        it('caps a boost at the headroom the measured true peak leaves', () => {
            // Aim -18, measured -28: ten wanted, but a true peak of -5 leaves four under the ceiling.
            expect(programmeGainFor({ loudnessLufs: -28, truePeakDb: -5 }, TARGET, TRIM)).toBe(CEILING_DBTP - -5);
        });

        it('treats a sample peak as optimistic when no true peak was measured', () => {
            expect(programmeGainFor({ loudnessLufs: -28, samplePeakDb: -5 }, TARGET, TRIM)).toBe(CEILING_DBTP - (-5 + TRUE_PEAK_ALLOWANCE_DB));
        });

        it('refuses any boost when the peak is unknown', () => {
            expect(programmeGainFor({ loudnessLufs: -28 }, TARGET, TRIM)).toBe(0);
            // The unmeasured episode at the station's own default: the assumed level sits under the
            // aim, and with no peak there is nothing to spend.
            expect(DEFAULT_TARGET_LUFS - DEFAULT_SPEECH_TRIM_DB - ASSUMED_PROGRAMME_LUFS).toBeGreaterThan(0);
            expect(programmeGainFor({}, DEFAULT_TARGET_LUFS, DEFAULT_SPEECH_TRIM_DB)).toBe(0);
        });

        it('refuses a boost to a master already over the ceiling, and never pulls it down for that', () => {
            expect(programmeGainFor({ loudnessLufs: -28, truePeakDb: 0.5 }, TARGET, TRIM)).toBe(0);
        });

        it('always allows a cut, peak or no peak', () => {
            expect(programmeGainFor({ loudnessLufs: -10 }, TARGET, TRIM)).toBe(TARGET - TRIM + 10);
            expect(programmeGainFor({ loudnessLufs: -10, truePeakDb: 2 }, TARGET, TRIM)).toBe(TARGET - TRIM + 10);
        });

        it('is the default, so a programme that does not say whose audio it is gets the cap', () => {
            expect(programmeGainFor({ loudnessLufs: -28 }, TARGET, TRIM)).toBe(programmeGainFor({ loudnessLufs: -28 }, TARGET, TRIM, 'mastered'));
        });
    });

    // A narration the station read itself is a programme to the mount, and its own voice to the mixer:
    // its peaks are plosives the bus limiter is for, on `speechGainFor`'s argument.
    describe('a programme the station spoke', () => {
        it('is lifted without a peak, as a break is, up to the record cap', () => {
            expect(programmeGainFor({ loudnessLufs: -26.5 }, TARGET, TRIM, 'station')).toBe(TARGET - TRIM + 26.5);
            expect(programmeGainFor({ loudnessLufs: -26.5, truePeakDb: -2 }, TARGET, TRIM, 'station')).toBe(TARGET - TRIM + 26.5);
        });
    });
});

describe('duckBedLufsFor', () => {
    const UNDER = DEFAULT_DUCK_UNDER_VOICE_DB;

    it('puts the bed that far under where a break is aimed', () => {
        // Where the voice lands is the target less the trim, whatever the segment measured: that is
        // what `speechGainFor` aims every break at.
        expect(duckBedLufsFor(TARGET, TRIM, UNDER)).toBe(TARGET - TRIM - UNDER);
        expect(duckBedLufsFor(TARGET, TRIM, UNDER)).toBe(TARGET + speechGainFor({ loudnessLufs: TARGET }, TARGET, TRIM) - UNDER);
    });

    it('ducks a record at the default target exactly as the fixed -12 dB duck did', () => {
        // The claim the default rests on: only quieter and louder passages should move.
        expect(duckBedLufsFor(DEFAULT_TARGET_LUFS, DEFAULT_SPEECH_TRIM_DB, UNDER)).toBe(DEFAULT_TARGET_LUFS - 12);
    });

    it('follows the target and the trim, which is why it rides on the cue', () => {
        expect(duckBedLufsFor(TARGET - 3, TRIM, UNDER)).toBe(duckBedLufsFor(TARGET, TRIM, UNDER) - 3);
        expect(duckBedLufsFor(TARGET, TRIM + 2, UNDER)).toBe(duckBedLufsFor(TARGET, TRIM, UNDER) - 2);
    });

    it('moves the bed and not the voice when the distance under it changes', () => {
        // The difference from the trim, and the reason both are settings: the trim moves the two
        // together, so only this one answers "I cannot hear the DJ over the intro".
        expect(duckBedLufsFor(TARGET, TRIM, UNDER + 4)).toBe(duckBedLufsFor(TARGET, TRIM, UNDER) - 4);
        expect(speechAimLufs(TARGET, TRIM)).toBe(TARGET - TRIM);
    });

    it('falls back to the defaults for a figure that is not a number', () => {
        expect(duckBedLufsFor(Number.NaN, Number.NaN, Number.NaN)).toBe(duckBedLufsFor(DEFAULT_TARGET_LUFS, DEFAULT_SPEECH_TRIM_DB, UNDER));
    });
});

describe('resolveDuck', () => {
    it('answers the defaults for settings nobody set', () => {
        expect(resolveDuck('', '', '')).toEqual({
            underVoiceDb: DEFAULT_DUCK_UNDER_VOICE_DB,
            deepestDb: DEFAULT_DUCK_DEEPEST_DB,
            shallowestDb: DEFAULT_DUCK_SHALLOWEST_DB,
        });
        expect(resolveDuck(undefined, 'deeper', 'a bit')).toEqual(resolveDuck('', '', ''));
    });

    it('reads each figure, however it was stored', () => {
        // A setting is a string; a test handing over a number would pass either way.
        expect(resolveDuck('14', '-24', '-1.5')).toEqual({ underVoiceDb: 14, deepestDb: -24, shallowestDb: -1.5 });
    });

    it('clamps each figure into its range rather than refusing it', () => {
        const duck = resolveDuck('99', '-99', '6');
        expect(duck.underVoiceDb).toBe(DUCK_UNDER_VOICE_RANGE.max);
        expect(duck.deepestDb).toBe(DUCK_DEEPEST_RANGE.min);
        expect(duck.shallowestDb).toBe(DUCK_SHALLOWEST_RANGE.max);
        // A bound above zero would be a boost under the voice.
        expect(resolveDuck('', '4', '').deepestDb).toBe(0);
    });

    it('answers a shallowest set deeper than the deepest with the deepest, which is a fixed drop', () => {
        // What radio.liq would do with the pair anyway, said on the cue rather than settled there.
        expect(resolveDuck('', '-8', '-12')).toMatchObject({ deepestDb: -8, shallowestDb: -8 });
    });

    it('matches the radio.env fallbacks it replaces', () => {
        // `DUCK_GAIN_DB` and `DUCK_MIN_DB` in stream/radio.default.env, which a cue from an older
        // app still ducks by: a default that disagreed would be a duck that changed at an upgrade.
        expect(DEFAULT_DUCK_DEEPEST_DB).toBe(-18);
        expect(DEFAULT_DUCK_SHALLOWEST_DB).toBe(-3);
    });
});
