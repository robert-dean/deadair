import { describe, expect, it } from 'vitest';

import { PUBLIC_PATHS, resolveAuthRedirect } from '../../src/auth/auth.gate';

describe('resolveAuthRedirect', () => {
    it('sends an anonymous visitor on a guarded path to /login', () => {
        expect(resolveAuthRedirect('/dashboard', false)).toBe('/login');
    });

    it.each(PUBLIC_PATHS)('leaves an anonymous visitor on the public path %s', pathname => {
        expect(resolveAuthRedirect(pathname, false)).toBeUndefined();
    });

    it('pulls an authenticated visitor off /login', () => {
        expect(resolveAuthRedirect('/login', true)).toBe('/');
    });

    it('leaves an authenticated visitor on a guarded path', () => {
        expect(resolveAuthRedirect('/dashboard', true)).toBeUndefined();
    });
});
