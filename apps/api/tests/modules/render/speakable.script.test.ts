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

    it('drops the asterisks a model puts round a title, and keeps the title', () => {
        // Measured: `the album is *The Soft Parade*` reached the engine, which reads the asterisk. The
        // first fix took the title out with the marks, and this test pinned "The album is , and I love it."
        expect(spoken('The album is *The Soft Parade*, and I love it.')).toBe('The album is The Soft Parade, and I love it.');
    });

    describe('asterisks, which are emphasis far more often than a stage direction', () => {
        // Measured on the live station: of 30 captured talk-break answers with a `*...*` run in them,
        // 28 had put a title, an artist or an album in italics and 2 had stressed a word. None was a
        // stage direction. Deleting the run aired a hole where the record's name had been.

        it('keeps a title a model italicised, which is how it names records it was shown', () => {
            // Verbatim, audition 36f56b7b ordinal 19: both titles went, and the break was refused as
            // being about neither record.
            const answer = 'The last beat that just spun off was *Tornado Of Souls* and next we hit *Electric Eye*.';

            expect(spoken(answer)).toBe('The last beat that just spun off was Tornado Of Souls and next we hit Electric Eye.');
        });

        it('keeps a title that is not a record on the order, since nothing else can tell it from one', () => {
            // An album and a film, both measured, and neither is anything the writer was shown.
            expect(spoken('A straightforward anthem from *The Colour and the Shape*, it keeps climbing.')).toBe(
                'A straightforward anthem from The Colour and the Shape, it keeps climbing.',
            );
            expect(spoken('It pulls a line out of *The Dark Knight*.')).toBe('It pulls a line out of The Dark Knight.');
        });

        it('keeps a stressed word, which reads as a hole when it goes', () => {
            expect(spoken('The master changed so the sax would actually *talk* instead of whisper.')).toBe(
                'The master changed so the sax would actually talk instead of whisper.',
            );
            // The exclamations that put this rule here in the first place are words the persona is
            // asked to say out loud. It was only ever the asterisks that could not be read.
            expect(spoken('*yikes* That was loud.')).toBe('yikes That was loud.');
        });

        it('reads bold the same way', () => {
            expect(spoken('Here comes **Miles From Nowhere** by Yusuf.')).toBe('Here comes Miles From Nowhere by Yusuf.');
            expect(spoken('Next up, **“As Above So Below”**—this one is insane.')).toBe('Next up, “As Above So Below”—this one is insane.');
        });

        it('keeps every word of a title the model tried to stress inside itself', () => {
            // Verbatim. The old strip read this as two runs and aired "Wanna".
            expect(spoken('Tonight’s next riff—*I *Wanna* Rock.*')).toBe('Tonight’s next riff—I Wanna Rock.');
        });

        it('still drops a run that is a stage direction', () => {
            expect(spoken('*laughs nervously* Well, that happened.')).toBe('Well, that happened.');
            expect(spoken('That was the one. **sighs** Anyway.')).toBe('That was the one. Anyway.');
        });

        it('drops an italicised title carrying a stage-direction word, which is the known price', () => {
            // 10 of the live station's 1,388 tracks. Pinned so that changing it is a decision.
            expect(spoken('That was *Beat It*, and it still works.')).toBe('That was , and it still works.');
        });
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
