import { afterEach, describe, expect, it, vi } from 'vitest';

import { authHeaders, clearSession, isAuthenticated, isSessionActive, setSession, subscribe } from '../../src/auth/session.store';

afterEach(() => {
    clearSession();
});

describe('session.store', () => {
    it('is anonymous until a session is set, then clears back to anonymous', () => {
        expect(isAuthenticated()).toBe(false);

        setSession('token-123', 3600);
        expect(isAuthenticated()).toBe(true);

        clearSession();
        expect(isAuthenticated()).toBe(false);
    });

    it('produces empty auth headers while anonymous', () => {
        expect(authHeaders()).toEqual({});
    });

    it('produces a bearer header once a token is set', () => {
        setSession('token-123', 3600);
        expect(authHeaders()).toEqual({ Authorization: 'Bearer token-123' });
    });

    it('reports authenticated both ways depending on token presence', () => {
        expect(isAuthenticated()).toBe(false);
        setSession('token-123', 3600);
        expect(isAuthenticated()).toBe(true);
    });

    it('treats an expired token as anonymous and sends no bearer header for it', () => {
        setSession('token-123', -1);

        expect(isAuthenticated()).toBe(false);
        expect(authHeaders()).toEqual({});
    });

    it('reads expiry off a snapshot without touching module state', () => {
        expect(isSessionActive({})).toBe(false);
        expect(isSessionActive({ accessToken: 'token-123' })).toBe(true);
        expect(isSessionActive({ accessToken: 'token-123', expiresAt: Date.now() - 1 })).toBe(false);
        expect(isSessionActive({ accessToken: 'token-123', expiresAt: Date.now() + 60_000 })).toBe(true);
        expect(isAuthenticated()).toBe(false);
    });

    it('notifies subscribers when the session changes', () => {
        const listener = vi.fn();
        const unsubscribe = subscribe(listener);

        setSession('token-123', 3600);
        expect(listener).toHaveBeenCalledTimes(1);

        clearSession();
        expect(listener).toHaveBeenCalledTimes(2);

        unsubscribe();
    });
});
