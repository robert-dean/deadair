import { describe, expect, it } from 'vitest';

import { i18n, pickLocale } from '../../src/i18n/i18n.setup';

describe('pickLocale', () => {
    it('matches a regional tag on its language', () => {
        expect(pickLocale(['en-GB'])).toBe('en');
    });

    it('takes the first preference it can speak', () => {
        expect(pickLocale(['xx-YY', 'EN-us'])).toBe('en');
    });

    it('falls back to the source language', () => {
        expect(pickLocale(['xx'])).toBe('en');
        expect(pickLocale([])).toBe('en');
    });
});

describe('the installed catalog', () => {
    it('is ready without waiting, so the first render has its words', () => {
        expect(i18n.isInitialized).toBe(true);
        expect(i18n.t('action.cancel')).toBe('Cancel');
    });

    it('interpolates without escaping, because React already does', () => {
        expect(i18n.t('notify.saved', { what: 'Rock & roll' })).toBe('Rock & roll saved.');
    });

    it('marks the document with the language on screen', () => {
        expect(document.documentElement.lang).toBe('en');
    });
});
