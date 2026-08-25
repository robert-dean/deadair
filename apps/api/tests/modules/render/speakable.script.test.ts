// What a model wrote, as words an engine may actually be handed. This was `readAnswer`'s tidying
// half and is now shared with the production path, which never had it: the first live call-in aired
// an album title with the asterisks still round it, because the engine reads what it is given.
//
// The case that matters most here is the one the split exists for: which cues survive is the
// CALLER's question. A script is stripped against what its writer was offered, and never against the
// whole vocabulary — reaching for that is how a presenter starts coughing on a station that widened
// the list for somebody else.

import { describe, expect, it } from 'vitest';

import { MAX_REACTIONS, speakableScript, stripWrapping } from '../../../src/modules/render/speakable.script.js';
import { PRESENTER_CUES } from '../../../src/modules/director/break.prompt.js';
import { CALLER_CUES } from '../../../src/modules/productions/production.cues.js';

const spoken = (text: string, perform: readonly (typeof CALLER_CUES)[number][] = PRESENTER_CUES) => speakableScript(text, { perform });

describe('what survives', () => {
    it('keeps a cue the writer was offered', () => {
        expect(spoken('[laugh] Right, that was something.')).toBe('[laugh] Right, that was something.');
    });

    it('drops a cue the writer was NOT offered, even though the vocabulary has it', () => {
        // The whole reason the allowed set is a parameter. A presenter offered four must not keep a
        // cough just because a caller somewhere else may use one.
        expect(spoken('[cough] Right, that was something.')).toBe('Right, that was something.');
    });

    it('keeps that same cough for a caller, who was offered it', () => {
        expect(spoken('[cough] Sorry, hi. Yeah.', CALLER_CUES)).toBe('[cough] Sorry, hi. Yeah.');
    });

    it('keeps a multi-word cue whole', () => {
        expect(spoken('[clear throat] Right then.', CALLER_CUES)).toBe('[clear throat] Right then.');
    });

    it('drops a stage direction, which is the failure this exists for', () => {
        expect(spoken('[warmly] Hello there.')).toBe('Hello there.');
        expect(spoken('*sighs* Hello there.')).toBe('Hello there.');
        expect(spoken('(laughs) Hello there.')).toBe('Hello there.');
    });

    it('drops the asterisks a model puts round a title, which went out on air with them in', () => {
        // Measured: `the album is *The Soft Parade*` reached the engine, which reads the asterisk.
        expect(spoken('The album is *The Soft Parade*, and I love it.')).toBe('The album is , and I love it.');
    });

    it('keeps only the first reaction, however many were written', () => {
        const script = spoken('[laugh] One. [laugh] Two. [sigh] Three.');

        expect((script?.match(/\[/g) ?? []).length).toBe(MAX_REACTIONS);
        expect(script).toContain('One.');
        expect(script).toContain('Three.');
    });

    it('takes what follows a reasoning model thinking out loud', () => {
        expect(spoken('<think>hmm what rhymes</think> Here we go.')).toBe('Here we go.');
    });

    it('drops a speaker label the model put on the front', () => {
        expect(spoken('Host: Here we go.')).toBe('Here we go.');
    });

    it('answers nothing when there was nothing but notation', () => {
        expect(spoken('[warmly]')).toBeUndefined();
        expect(spoken('   ')).toBeUndefined();
    });
});

describe('stripWrapping', () => {
    it('unwraps a model quoting its whole answer', () => {
        expect(spoken('"Here we go, then."')).toBe('Here we go, then.');
    });

    it('leaves a quotation inside a line alone', () => {
        expect(stripWrapping('He said "no" and left', '"', '"')).toBe('He said "no" and left');
    });
});
