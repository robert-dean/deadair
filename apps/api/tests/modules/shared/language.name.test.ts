import { describe, expect, it } from 'vitest';

import { languageName, languageRule } from '../../../src/modules/shared/language.name.js';

describe('languageName', () => {
    it('names a language in English, regional variants included', () => {
        expect(languageName('de')).toBe('German');
        expect(languageName('fr-ca')).toBe('Canadian French');
    });

    it('answers the tag itself for one it cannot name or parse', () => {
        expect(languageName('zz')).toBe('zz');
        expect(languageName('not a tag')).toBe('not a tag');
    });
});

describe('languageRule', () => {
    it('asks for the language by name and keeps titles and names as written', () => {
        const rule = languageRule('es');

        expect(rule).toContain('Write every word you say in Spanish');
        expect(rule).toContain('Some of what you are given is in English');
        expect(rule).toContain('titles of records');
    });
});
