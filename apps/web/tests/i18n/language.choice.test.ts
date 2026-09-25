import { describe, expect, it } from 'vitest';

import { chooseLanguage } from '../../src/i18n/language.choice';

describe('chooseLanguage', () => {
    it('takes the operator’s choice over the browser', () => {
        expect(chooseLanguage({ chosen: 'de', preferred: ['fr'], available: ['de', 'fr'] })).toBe('de');
    });

    it('takes English as a choice, whatever the browser prefers', () => {
        expect(chooseLanguage({ chosen: 'en', preferred: ['de'], available: ['de'] })).toBe('en');
    });

    it('lets the browser decide when the chosen language has gone', () => {
        expect(chooseLanguage({ chosen: 'it', preferred: ['de'], available: ['de'] })).toBe('de');
    });

    it('reads the browser in its own order, English included', () => {
        expect(chooseLanguage({ preferred: ['en-US', 'de'], available: ['de'] })).toBe('en');
        expect(chooseLanguage({ preferred: ['xx', 'de-AT'], available: ['de'] })).toBe('de');
    });

    it('prefers the exact variety over another of the same language', () => {
        expect(chooseLanguage({ preferred: ['pt-BR'], available: ['pt-PT', 'pt-BR'] })).toBe('pt-BR');
        expect(chooseLanguage({ preferred: ['pt-BR'], available: ['pt-PT'] })).toBe('pt-PT');
    });

    it('falls back to English', () => {
        expect(chooseLanguage({ preferred: ['ja'], available: ['de'] })).toBe('en');
    });
});
