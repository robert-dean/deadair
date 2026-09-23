// A path to return to after signing in crosses an identity provider and back. Whatever survives
// this check becomes a query parameter on the console's own callback page, never a destination.

import { describe, expect, it } from 'vitest';

import { safeRedirectPath } from '../../../src/modules/authentication/redirect.after.js';

describe('safeRedirectPath', () => {
    it('keeps a path on the console, query and all', () => {
        expect(safeRedirectPath('/settings/security?linked=google')).toBe('/settings/security?linked=google');
    });

    it.each(['https://evil.example/', '//evil.example/', '/\\evil.example/', 'settings', 'javascript:alert(1)', ''])('drops %j', value => {
        expect(safeRedirectPath(value)).toBeUndefined();
    });

    it('answers nothing for nothing', () => {
        expect(safeRedirectPath(undefined)).toBeUndefined();
    });
});
