import { describe, expect, it } from 'vitest';

import { PUBLIC_PATHS, resolveAuthRedirect } from '../../src/auth/auth.gate';

describe('resolveAuthRedirect', () => {
    it('sends an anonymous visitor on a guarded path to /login', () => {
        expect(resolveAuthRedirect('/dashboard', false)).toBe('/login');
    });

    it.each(PUBLIC_PATHS)('leaves an anonymous visitor on the public path %s', pathname => {
        expect(resolveAuthRedirect(pathname, false)).toBeUndefined();
    });

    // An app's consent page must never be public: approving acts as whoever is signed in, so an
    // anonymous visitor is sent to sign in first and comes back with the app's query intact.
    it('keeps the OAuth consent page behind sign-in', () => {
        expect(resolveAuthRedirect('/oauth/authorize', false)).toBe('/login');
        expect(resolveAuthRedirect('/oauth/authorize', true)).toBeUndefined();
    });

    it('pulls an authenticated visitor off /login', () => {
        expect(resolveAuthRedirect('/login', true)).toBe('/');
    });

    it('leaves an authenticated visitor on a guarded path', () => {
        expect(resolveAuthRedirect('/dashboard', true)).toBeUndefined();
    });
});
