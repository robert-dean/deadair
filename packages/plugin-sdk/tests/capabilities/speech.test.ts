// The station's performance-cue vocabulary, and the two functions every consumer of it goes through.
//
// Pure, so what they cannot pin is whether an engine performs a cue well. What they CAN pin is the
// safe direction: a cue nobody claimed is gone by the time an engine sees the text, which is the one
// property that keeps the word "laugh" from being read out loud.

import { describe, expect, it } from 'vitest';

import { cuesIn, isSpeechDelivery, SPEECH_CUES, SPEECH_DELIVERIES, withoutCues, type SpeechCue } from '../../src/capabilities/speech.js';

describe('SPEECH_CUES', () => {
    // This asserted that every cue was a SINGLE word, and said in as many words that the day
    // somebody added `clear throat` it would fail and point at the reason. Somebody did, so what it
    // was pointing at is now the rule: every matcher built from this list orders the longest form
    // first, the way `applyPronunciations` does one layer up.
    it('matches a multi-word cue whole, rather than leaving half of it as text', () => {
        expect(cuesIn('[clear throat] Right then.')).toEqual(['clear throat']);
        expect(withoutCues('[clear throat] Right then.')).toBe('Right then.');
    });

    it('is lowercase and has no duplicates, which is what the sets built from it assume', () => {
        for (const cue of SPEECH_CUES) expect(cue, `${cue} is not lowercase`).toBe(cue.toLowerCase());
        expect([...SPEECH_CUES]).toHaveLength(new Set(SPEECH_CUES).size);
    });

    it('keeps the four a presenter performs at the front, because the host-side set names them', () => {
        // `PRESENTER_CUES` app-side is the original four and this list is the vocabulary. Nothing
        // reads the order, but the split is easier to hold onto when the file agrees with it.
        expect([...SPEECH_CUES].slice(0, 4)).toEqual(['laugh', 'chuckle', 'sigh', 'gasp']);
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

// The station's word for how a whole line is read. Pure, like the cues, and the property worth pinning
// is the same one in the other direction: the vocabulary is closed, so only an exact word counts, and
// the cue machinery leaves a delivery mark alone because lifting it is the writer's job, not this file's.
describe('SPEECH_DELIVERIES', () => {
    it('is two readings either side of an ordinary one, which is absent rather than named', () => {
        expect([...SPEECH_DELIVERIES]).toEqual(['hushed', 'frantic']);
    });

    it('shares no word with the cues, since a cue and a delivery mean different things in brackets', () => {
        for (const delivery of SPEECH_DELIVERIES) expect(SPEECH_CUES as readonly string[]).not.toContain(delivery);
    });
});

describe('isSpeechDelivery', () => {
    it('accepts the station words exactly as written', () => {
        expect(isSpeechDelivery('hushed')).toBe(true);
        expect(isSpeechDelivery('frantic')).toBe(true);
    });

    it('refuses anything else, including a word in the wrong case and a number', () => {
        // A closed vocabulary is only a guard if the check is exact. The host normalises case where it
        // reads a model's answer, and nowhere else should anything be let through on a near miss.
        expect(isSpeechDelivery('Hushed')).toBe(false);
        expect(isSpeechDelivery('shouty')).toBe(false);
        expect(isSpeechDelivery('')).toBe(false);
        expect(isSpeechDelivery(0.9)).toBe(false);
        expect(isSpeechDelivery(undefined)).toBe(false);
    });
});

describe('withoutCues and a delivery mark', () => {
    it('leaves a delivery mark where it is, because it is not a cue', () => {
        expect(withoutCues('[hushed] Something is out there. [sigh]')).toBe('[hushed] Something is out there.');
        expect(cuesIn('[frantic] Go, go, go.')).toEqual([]);
    });
});
