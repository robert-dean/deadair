import { describe, expect, it } from 'vitest';

import { tokenFromHash } from '../../src/invite/invite.token';

describe('tokenFromHash', () => {
    it('reads the token after #, trimmed', () => {
        expect(tokenFromHash('#di_abc ')).toBe('di_abc');
    });

    it('reads nothing from an empty, oversized or malformed fragment', () => {
        expect(tokenFromHash('')).toBeUndefined();
        expect(tokenFromHash('#')).toBeUndefined();
        expect(tokenFromHash(`#${'a'.repeat(201)}`)).toBeUndefined();
        expect(tokenFromHash('#%E0%A4%A')).toBeUndefined();
    });
});
