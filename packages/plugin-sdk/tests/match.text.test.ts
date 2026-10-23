import { describe, expect, it } from 'vitest';

import { baseForm, normalize, textAgreement } from '../src/match.text.js';

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

describe('textAgreement', () => {
    it('is exact for the same name in comparison form', () => {
        expect(textAgreement('Mr. Brightside', 'mr brightside')).toBe('exact');
        expect(textAgreement('Beyoncé', 'Beyonce')).toBe('exact');
    });

    it('is base for the same name once a decoration is dropped', () => {
        expect(textAgreement('Roads (Live)', 'Roads')).toBe('base');
        expect(textAgreement('Roads - 2011 Remaster', 'Roads')).toBe('base');
    });

    it('is none for a different name or a missing one', () => {
        expect(textAgreement('Glory Box', 'Roads')).toBe('none');
        expect(textAgreement(undefined, 'Roads')).toBe('none');
        expect(textAgreement(null, 'Roads')).toBe('none');
        expect(textAgreement('', 'Roads')).toBe('none');
    });
});
