import { describe, expect, it } from 'vitest';

import { safeRedirectTarget } from '../../src/auth/redirect.target';

describe('safeRedirectTarget', () => {
    it('preserves a plain app path', () => {
        expect(safeRedirectTarget('/dashboard')).toBe('/dashboard');
    });

    it.each([undefined, '', '//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)'])('falls back to / for %s', value => {
        expect(safeRedirectTarget(value)).toBe('/');
    });
});
