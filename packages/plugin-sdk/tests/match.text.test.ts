import { describe, expect, it } from 'vitest';

import { baseForm, normalize } from '../src/match.text.js';

describe('normalize', () => {
    it('sees through accents', () => {
        expect(normalize('Beyoncé')).toBe(normalize('BEYONCE'));
        expect(normalize('Beyoncé')).toBe('beyonce');
    });

    it('folds case', () => {
        expect(normalize('Mr. Brightside')).toBe(normalize('Mr Brightside'));
    });

    it('strips punctuation', () => {
        expect(normalize('Mr. Brightside')).toBe('mr brightside');
        expect(normalize("Sgt. Pepper's")).toBe('sgt pepper s');
    });

    it('collapses runs of whitespace', () => {
        expect(normalize('  Sgt.   Pepper  ')).toBe('sgt pepper');
    });
});

describe('baseForm', () => {
    it('drops a parenthesised suffix', () => {
        expect(baseForm('Roads (2011 Remaster)')).toBe('roads');
        expect(baseForm('Roads [Radio Edit]')).toBe('roads');
    });

    it('splits on a spaced dash, including en and em dashes', () => {
        expect(baseForm('Roads - Live')).toBe('roads');
        expect(baseForm('Roads – Live')).toBe('roads');
        expect(baseForm('Roads — Live')).toBe('roads');
    });

    it('leaves a plain title alone', () => {
        expect(baseForm('Glory Box')).toBe('glory box');
    });
});
