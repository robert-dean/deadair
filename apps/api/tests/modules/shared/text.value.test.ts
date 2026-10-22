import { describe, expect, it } from 'vitest';

import { nonEmptyText } from '../../../src/modules/shared/text.value.js';

describe('nonEmptyText', () => {
    it('trims a string with something in it', () => {
        expect(nonEmptyText('  Portishead ')).toBe('Portishead');
    });

    it('reads blank and whitespace-only as not set, which is what a model writes for a field it has nothing for', () => {
        expect(nonEmptyText('')).toBeUndefined();
        expect(nonEmptyText(' \n\t ')).toBeUndefined();
    });

    it('reads anything that is not a string as not set rather than coercing it', () => {
        expect(nonEmptyText(undefined)).toBeUndefined();
        expect(nonEmptyText(null)).toBeUndefined();
        expect(nonEmptyText(42)).toBeUndefined();
        expect(nonEmptyText(['a'])).toBeUndefined();
    });
});
