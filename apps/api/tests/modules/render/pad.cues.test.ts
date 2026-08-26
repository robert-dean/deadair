// A pad hit rides inside a script as `[sfx:airhorn]`, and three things have to be true of it or the
// station says the word "sfx" out loud on air: it is found where it happens, it comes out cleanly on
// the way to an engine, and a name the character's board does not hold is dropped rather than
// refused. The last one is the bargain every guard on this path keeps — declining costs the station
// the model's sentence, and an invented pad name is a notation problem in an answer that is fine.

import { describe, expect, it } from 'vitest';

import { keepPads, MAX_PADS, padCue, padsIn, withoutPads } from '../../../src/modules/render/pad.cues.js';
import { speakableScript } from '../../../src/modules/render/speakable.script.js';
import { transposeForSpeech } from '../../../src/modules/render/speech.transpose.js';

describe('padsIn', () => {
    it('finds a hit in the order it happens, lower-cased', () => {
        expect(padsIn('Well. [sfx:airhorn] There it is. [SFX:Rimshot]')).toEqual(['airhorn', 'rimshot']);
    });

    it('finds nothing in a script that hit nothing', () => {
        expect(padsIn('Well. There it is.')).toEqual([]);
    });

    it('does not read a reaction or a stage direction as a pad', () => {
        expect(padsIn('Well [laugh] there it is [warmly] [sfx]')).toEqual([]);
    });
});

describe('withoutPads', () => {
    it('takes a hit out and closes the space it leaves', () => {
        expect(withoutPads('Well. [sfx:airhorn] There it is.')).toBe('Well. There it is.');
    });

    it('does not leave a space in front of the punctuation after it', () => {
        expect(withoutPads('Ambitious [sfx:rimshot], and they played it anyway.')).toBe('Ambitious, and they played it anyway.');
    });

    it('keeps only what it is told to keep, which is the safe direction by default', () => {
        expect(withoutPads('[sfx:airhorn] and [sfx:rimshot]', ['airhorn'])).toBe('[sfx:airhorn] and');
    });

    it('leaves every other bracketed thing exactly as it arrived', () => {
        // Not a bracket stripper. What happens to `[warmly]` is `speakableScript`'s question.
        expect(withoutPads('[laugh] well [warmly] there')).toBe('[laugh] well [warmly] there');
    });
});

describe('keepPads', () => {
    it('drops a name the board does not hold', () => {
        expect(keepPads('Well [sfx:vuvuzela] there it is.', ['airhorn'])).toBe('Well there it is.');
    });

    it('keeps the first hit and drops the rest, because a soundboard is funny once', () => {
        const kept = keepPads('[sfx:airhorn] a [sfx:airhorn] b [sfx:airhorn]', ['airhorn']);

        expect(padsIn(kept)).toHaveLength(MAX_PADS);
        // The FIRST rather than the best: there is no way to rank them, and the earliest is the one
        // the model committed to before it got carried away.
        expect(kept.startsWith('[sfx:airhorn]')).toBe(true);
    });

    it('normalises the case a model happened to answer in', () => {
        expect(keepPads('Well [SFX:AirHorn] there.', ['airhorn'])).toBe('Well [sfx:airhorn] there.');
    });

    it('takes them all out for a character with no board at all', () => {
        expect(keepPads('Well [sfx:airhorn] there.', [])).toBe('Well there.');
    });
});

describe('padCue', () => {
    it('writes what a script has to carry, which is what the prompt offers', () => {
        expect(padCue('AirHorn')).toBe('[sfx:airhorn]');
        // The round trip is the point: what the prompt shows must be findable in the answer.
        expect(padsIn(padCue('airhorn'))).toEqual(['airhorn']);
    });
});

describe('a pad through speakableScript', () => {
    // The ordering that makes this work is easy to get backwards, and it was: the bracket strip
    // drops every run it does not recognise, so a pad admitted AFTER it would be admitted into a
    // script that had already been emptied of pads.
    it('survives the strip that removes every other bracketed thing', () => {
        const script = speakableScript('Ambitious [warmly] record. [sfx:rimshot] They played it anyway.', {
            perform: [],
            pads: ['rimshot'],
        });

        expect(script).toBe('Ambitious record. [sfx:rimshot] They played it anyway.');
    });

    it('is removed like any other stage direction when the character has no board', () => {
        const script = speakableScript('Ambitious record. [sfx:rimshot] They played it anyway.', { perform: [] });

        expect(script).toBe('Ambitious record. They played it anyway.');
    });

    it('sits beside a reaction without either one taking the other out', () => {
        const script = speakableScript('Ambitious [laugh] record. [sfx:rimshot] Anyway.', {
            perform: ['laugh'],
            pads: ['rimshot'],
        });

        expect(script).toBe('Ambitious [laugh] record. [sfx:rimshot] Anyway.');
    });

    it('drops a pad the writer was never offered even where it was offered another', () => {
        const script = speakableScript('[sfx:vuvuzela] Ambitious record.', { perform: [], pads: ['rimshot'] });

        expect(script).toBe('Ambitious record.');
    });
});

describe('a pad on the way to an engine', () => {
    // The door this closes: `SPARE_CUES` holds `[laugh]` out of the decoration strip, and its
    // character class contains `[` and `]`. A pad reaching that regex loses its brackets and arrives
    // at the engine as the bare text `sfx:airhorn`, which is read out loud.
    it('is gone entirely, brackets and name together', () => {
        const spoken = transposeForSpeech('Ambitious record. [sfx:rimshot] They played it anyway.');

        expect(spoken).not.toContain('sfx');
        expect(spoken).not.toContain('rimshot');
        expect(spoken).toBe('Ambitious record. They played it anyway.');
    });

    it('does not take a performance cue with it, which the engine does perform', () => {
        expect(transposeForSpeech('Ambitious [laugh] record. [sfx:rimshot] Anyway.')).toBe('Ambitious [laugh] record. Anyway.');
    });

    it('leaves a script that is nothing but a pad as the words it had, rather than as silence', () => {
        // `transposeForSpeech` answers the original when its passes leave nothing, on the rule that
        // an empty reading means the transposition was wrong. A pad-only script is the one case that
        // can now reach it, and a segment that renders silence is a hole in the hour.
        expect(transposeForSpeech('[sfx:airhorn]')).toBe('[sfx:airhorn]');
    });
});
