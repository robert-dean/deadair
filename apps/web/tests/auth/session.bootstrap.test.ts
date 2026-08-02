import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';

import { clearSession, getSession, isAuthenticated, setSession } from '../../src/auth/session.store';
import { resetSessionBootstrap, restoreSession } from '../../src/auth/session.bootstrap';

/** What the API returns when the refresh cookie is missing, expired, or revoked. */
function unauthorized(): SdkError {
    return new SdkError(401, 'Unauthorized', { statusCode: 401, message: 'invalid_grant' }, new Headers());
}

/** What a reachable-but-broken API returns: says nothing about the cookie. */
function serverError(): SdkError {
    return new SdkError(503, 'Service Unavailable', { statusCode: 503, message: 'upstream down' }, new Headers());
}

const requestToken = vi.fn();

vi.mock('../../src/api/client', () => ({
    sdk: {
        authentication: {
            requestToken: (...args: unknown[]) => requestToken(...args),
        },
    },
}));

afterEach(() => {
    vi.useRealTimers();
    requestToken.mockReset();
    resetSessionBootstrap();
    clearSession();
});

describe('restoreSession', () => {
    it('stores the session and resolves truthy when the refresh cookie yields a token', async () => {
        requestToken.mockResolvedValue({ result: 'token', access_token: 'tok-1', expires_in: 3600 });

        const result = await restoreSession();

        expect(result).toBe(true);
        expect(getSession().accessToken).toBe('tok-1');
    });

    it('resolves falsy without throwing when the refresh lands on mfa_required', async () => {
        requestToken.mockResolvedValue({ result: 'mfa_required' });

        await expect(restoreSession()).resolves.toBe(false);
        expect(getSession().accessToken).toBeUndefined();
    });

    it('resolves falsy without throwing when the request rejects with a 401', async () => {
        requestToken.mockRejectedValue(unauthorized());

        await expect(restoreSession()).resolves.toBe(false);
        expect(getSession().accessToken).toBeUndefined();
    });

    it('makes the call once across concurrent and repeat invocations, then again after reset', async () => {
        requestToken.mockResolvedValue({ result: 'token', access_token: 'tok-1', expires_in: 3600 });

        const [first, second] = await Promise.all([restoreSession(), restoreSession()]);
        await restoreSession();

        expect(first).toBe(true);
        expect(second).toBe(true);
        expect(requestToken).toHaveBeenCalledTimes(1);

        resetSessionBootstrap();
        await restoreSession();

        expect(requestToken).toHaveBeenCalledTimes(2);
    });

    it('answers repeat gate evaluations from a cached 401 rather than retrying in a loop', async () => {
        requestToken.mockRejectedValue(unauthorized());

        await restoreSession();
        await restoreSession();
        await restoreSession();

        expect(requestToken).toHaveBeenCalledTimes(1);
    });

    it('drops a dead token when the redeem is refused, so nothing downstream sends it', async () => {
        setSession('stale-token', 3600);
        requestToken.mockRejectedValue(unauthorized());

        await expect(restoreSession()).resolves.toBe(false);

        expect(getSession().accessToken).toBeUndefined();
        // The clear it just performed is its own doing and must not re-arm the attempt.
        await restoreSession();
        expect(requestToken).toHaveBeenCalledTimes(1);
    });

    it('does not cache an unreachable API, so the next gate evaluation tries again', async () => {
        requestToken.mockRejectedValue(new TypeError('Failed to fetch'));

        await expect(restoreSession()).resolves.toBe(false);
        await expect(restoreSession()).resolves.toBe(false);

        expect(requestToken).toHaveBeenCalledTimes(2);
    });

    it('does not cache a 5xx either: the server answered about itself, not about the cookie', async () => {
        requestToken.mockRejectedValue(serverError());

        await restoreSession();
        await restoreSession();

        expect(requestToken).toHaveBeenCalledTimes(2);
    });

    it('recovers on its own once connectivity returns, with no reset or reload', async () => {
        requestToken.mockRejectedValue(new TypeError('Failed to fetch'));
        await expect(restoreSession()).resolves.toBe(false);

        requestToken.mockResolvedValue({ result: 'token', access_token: 'tok-1', expires_in: 3600 });

        await expect(restoreSession()).resolves.toBe(true);
        expect(getSession().accessToken).toBe('tok-1');
    });

    it('leaves a live session in place when the redeem cannot reach the API', async () => {
        setSession('tok-live', 3600);
        requestToken.mockRejectedValue(new TypeError('Failed to fetch'));

        await restoreSession();

        expect(getSession().accessToken).toBe('tok-live');
        expect(isAuthenticated()).toBe(true);
    });

    it('still shares one in-flight redeem across concurrent callers when it fails transiently', async () => {
        requestToken.mockRejectedValue(new TypeError('Failed to fetch'));

        const [first, second] = await Promise.all([restoreSession(), restoreSession()]);

        expect(first).toBe(false);
        expect(second).toBe(false);
        expect(requestToken).toHaveBeenCalledTimes(1);
    });

    it('redeems the cookie after a sign-in instead of replaying a rejection cached before it', async () => {
        vi.useFakeTimers();
        // A fresh tab boots at /login: there is no cookie yet, so the boot redeem is refused and the
        // verdict "anonymous" is cached. Nothing is cleared, so only `setSession` can retire it.
        requestToken.mockRejectedValue(unauthorized());
        await expect(restoreSession()).resolves.toBe(false);
        expect(requestToken).toHaveBeenCalledTimes(1);

        // The user signs in. The server sets a fresh refresh cookie; the SPA sees only the token.
        setSession('tok-login', 3600);

        // An hour on, the access token has expired and the next navigation re-evaluates the gate.
        vi.setSystemTime(Date.now() + 3_600_001);
        expect(isAuthenticated()).toBe(false);
        requestToken.mockResolvedValue({ result: 'token', access_token: 'tok-refreshed', expires_in: 3600 });

        // The cookie the user earned by signing in gets its turn, rather than the stale rejection
        // standing in for it and stranding them back at /login.
        await expect(restoreSession()).resolves.toBe(true);

        expect(requestToken).toHaveBeenCalledTimes(2);
        expect(getSession().accessToken).toBe('tok-refreshed');
        expect(isAuthenticated()).toBe(true);
    });

    it('settles after the redeem that a sign-in re-armed, rather than re-arming on its own success', async () => {
        requestToken.mockRejectedValue(unauthorized());
        await restoreSession();

        setSession('tok-login', 3600);
        requestToken.mockResolvedValue({ result: 'token', access_token: 'tok-refreshed', expires_in: 3600 });

        // The sign-in re-arms the cache once; the redeem it allows stores a token of its own, and that
        // self-inflicted change must not re-arm the attempt that caused it.
        await restoreSession();
        await restoreSession();
        await restoreSession();

        expect(requestToken).toHaveBeenCalledTimes(2);
    });

    it('redeems again once the token it handed back has expired', async () => {
        vi.useFakeTimers();
        requestToken.mockResolvedValue({ result: 'token', access_token: 'tok-1', expires_in: 3600 });

        await restoreSession();
        expect(requestToken).toHaveBeenCalledTimes(1);

        vi.setSystemTime(Date.now() + 3_600_001);
        requestToken.mockResolvedValue({ result: 'token', access_token: 'tok-2', expires_in: 3600 });

        await expect(restoreSession()).resolves.toBe(true);

        expect(requestToken).toHaveBeenCalledTimes(2);
        expect(getSession().accessToken).toBe('tok-2');
    });
});
