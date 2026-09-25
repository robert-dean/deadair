import { describe, expect, it } from 'vitest';

import { assertStorableCatalog, CATALOG_LIMITS, canonicalLocale, requireLocale } from '../../../src/modules/languages/console.language.pack.js';

const status = (fn: () => void): number | undefined => {
    try {
        fn();
        return undefined;
    } catch (error) {
        return (error as { statusCode?: number }).statusCode;
    }
};

describe('canonicalLocale', () => {
    it('writes a tag the one way', () => {
        expect(canonicalLocale('pt-br')).toBe('pt-BR');
        expect(canonicalLocale(' de ')).toBe('de');
    });

    it('answers nothing for text that is not a tag', () => {
        expect(canonicalLocale('not a tag!')).toBeUndefined();
        expect(status(() => requireLocale('not a tag!'))).toBe(400);
    });
});

describe('assertStorableCatalog', () => {
    it('takes strings nested by namespace', () => {
        expect(() => assertStorableCatalog({ common: { action: { cancel: 'Abbrechen' } } })).not.toThrow();
    });

    it.each([
        ['a number', { common: { action: { cancel: 42 } } }],
        ['a list', { common: { action: ['Abbrechen'] } }],
        ['a null', { common: null }],
    ])('refuses %s where text or nesting belongs', (_, catalog) => {
        expect(status(() => assertStorableCatalog(catalog))).toBe(400);
    });

    it('refuses nesting deeper than a catalog goes', () => {
        let catalog: Record<string, unknown> = { leaf: 'x' };
        for (let level = 0; level < CATALOG_LIMITS.depth; level += 1) catalog = { deeper: catalog };
        expect(status(() => assertStorableCatalog(catalog))).toBe(400);
    });

    it('refuses a string longer than any a console says', () => {
        expect(status(() => assertStorableCatalog({ common: { long: 'x'.repeat(CATALOG_LIMITS.stringLength + 1) } }))).toBe(400);
    });

    it('refuses more strings than a console holds', () => {
        const many = Object.fromEntries(Array.from({ length: CATALOG_LIMITS.strings + 1 }, (_, index) => [`k${index}`, 'x']));
        expect(status(() => assertStorableCatalog({ common: many }))).toBe(400);
    });
});
