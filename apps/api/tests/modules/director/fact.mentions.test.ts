import { describe, expect, it } from 'vitest';
import { mentionsFact } from '../../../src/modules/director/fact.mentions.js';

const records = ['Pink Moon', 'Nick Drake', 'Solid Air', 'John Martyn'];

describe('mentionsFact', () => {
    it('counts a name the fact carries, in the presenter’s own sentence', () => {
        const fact = 'Pink Moon was recorded in two late-night sessions with John Wood at Sound Techniques.';

        expect(mentionsFact('Nick Drake cut this with John Wood over two nights. Pink Moon.', fact, records)).toBe(true);
    });

    it('counts a figure written in digits', () => {
        expect(mentionsFact('Recorded in 1972, and here it is.', 'Pink Moon was released in 1972.', records)).toBe(true);
    });

    it('answers no for a link that said none of it', () => {
        const fact = 'Pink Moon was recorded in two late-night sessions with John Wood at Sound Techniques.';

        expect(mentionsFact('Here is Nick Drake with Pink Moon.', fact, records)).toBe(false);
    });

    it('takes the records’ own names as no evidence, since a link names them anyway', () => {
        // "Nick" and "Drake" are in the fact and in every link about the record.
        expect(mentionsFact('That was Nick Drake.', 'Pink Moon was the last album Nick Drake released.', records)).toBeUndefined();
    });

    it('cannot tell for a fact with nothing distinctive in it, and says so', () => {
        expect(mentionsFact('Lovely stuff.', 'it was recorded quickly.', records)).toBeUndefined();
    });

    it('does not take the word opening a sentence for a name', () => {
        expect(mentionsFact('Recorded quickly, that one.', 'Recorded quickly. It was.', records)).toBeUndefined();
    });
});
