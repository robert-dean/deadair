// The station's performance-cue vocabulary, and the two functions every consumer of it goes through.
//
// Pure, so what they cannot pin is whether an engine performs a cue well. What they CAN pin is the
// safe direction: a cue nobody claimed is gone by the time an engine sees the text, which is the one
// property that keeps the word "laugh" from being read out loud.

import { describe, expect, it } from 'vitest';

import { cuesIn, SPEECH_CUES, withoutCues, type SpeechCue } from '../../src/capabilities/speech.js';

describe('SPEECH_CUES', () => {
    // Not a style rule. Every regex built from this list is a plain alternation, and a multi-word
    // entry would need the longest form ordered first the way `applyPronunciations` does — so the
    // day somebody adds `clear throat`, this fails and points at the reason.
    it('is single words, which is what lets every matcher be a plain alternation', () => {
        for (const cue of SPEECH_CUES) expect(cue, `${cue} has a space in it`).toMatch(/^[a-z]+$/);
    });
});

describe('cuesIn', () => {
    it('finds them in order, with repeats', () => {
        expect(cuesIn('[sigh] Well. [laugh] Anyway. [laugh] Right.')).toEqual(['sigh', 'laugh', 'laugh']);
    });

    it('reads a cue whatever case it was written in, and answers the canonical spelling', () => {
        expect(cuesIn('[LAUGH] and [Chuckle]')).toEqual(['laugh', 'chuckle']);
    });

    it('is not a bracket finder', () => {
        // The distinction this whole design rests on: `[warmly]` is the stage direction that was
        // being read out loud, and nothing here should start treating it as notation.
        expect(cuesIn('[warmly] Hello there. [pause] Yes.')).toEqual([]);
    });

    // A `g` flag carries `lastIndex`, so a shared matcher would answer differently on every other
    // call. Cheap to get wrong and invisible when it is.
    it('answers the same thing twice', () => {
        const text = '[laugh] Twice now.';

        expect(cuesIn(text)).toEqual(cuesIn(text));
    });
});

describe('withoutCues', () => {
    it('takes them all out by default, which is the safe direction', () => {
        expect(withoutCues('That was Nick Drake. [laugh] No idea what follows that.')).toBe('That was Nick Drake. No idea what follows that.');
    });

    it('keeps the ones it is told to keep', () => {
        expect(withoutCues('[laugh] Yes. [sigh] No.', ['laugh'])).toBe('[laugh] Yes. No.');
    });

    it('closes the gap a removal leaves rather than leaving a double space', () => {
        expect(withoutCues('one [sigh] two')).toBe('one two');
    });

    it('does not leave a space stranded in front of the punctuation behind a cue', () => {
        expect(withoutCues('Nick Drake [sigh], then.')).toBe('Nick Drake, then.');
    });

    it('leaves everything else in brackets exactly as it arrived', () => {
        // It is not a bracket stripper, and the filter that IS one lives upstream where the
        // difference between notation and a stage direction is already understood.
        expect(withoutCues('[warmly] Hello. [laugh] There.')).toBe('[warmly] Hello. There.');
    });

    it('removes a cue written in the wrong case, rather than mistaking it for words', () => {
        expect(withoutCues('[LAUGH] Right.')).toBe('Right.');
    });

    it('answers an empty string for a script that was nothing but a cue', () => {
        // Deliberate, and the honest answer: there are no words here. The render path refuses an
        // empty script visibly rather than airing the word "laugh", which is the alternative.
        expect(withoutCues('[laugh]')).toBe('');
    });

    it('keeps the cue that survives adjacent to one that does not', () => {
        const kept: SpeechCue[] = ['gasp'];

        expect(withoutCues('[chuckle] [gasp] Look at that.', kept)).toBe('[gasp] Look at that.');
    });
});
