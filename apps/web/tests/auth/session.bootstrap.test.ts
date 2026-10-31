import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { SdkError } from '@deadair/sdk';

import { clearSession, getSession, isAuthenticated, setSession } from '../../src/auth/session.store';
import { resetSessionBootstrap, restoreSession } from '../../src/auth/session.bootstrap';

/** What the API returns when the refresh cookie is expired or revoked, or its account is gone. */
function unauthorized(code = 'invalid_token'): SdkError {
    return new SdkError(
        401,
        'Unauthorized',
        { statusCode: 401, message: 'Unauthorized' },
        new Headers({ 'WWW-Authenticate': `Bearer error="${code}"` }),
    );
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

let queryClient: QueryClient;

/** The bootstrap sets its own retry policy, so the cache is left at library defaults here. */
beforeEach(() => {
    queryClient = new QueryClient();
});

afterEach(() => {
    vi.useRealTimers();
    requestToken.mockReset();
    queryClient.clear();
    clearSession();
});

describe('restoreSession', () => {
    it('stores the session and resolves truthy when the refresh cookie yields a token', async () => {
        requestToken.mockResolvedValue({ result: 'token', access_token: 'tok-1', expires_in: 3600 });

        const result = await restoreSession(queryClient);

        expect(result).toBe(true);
        expect(getSession().accessToken).toBe('tok-1');
    });

    it('resolves falsy without throwing when the refresh lands on mfa_required', async () => {
        requestToken.mockResolvedValue({ result: 'mfa_required' });

        await expect(restoreSession(queryClient)).resolves.toBe(false);
        expect(getSession().accessToken).toBeUndefined();
    });

    it('resolves falsy without throwing when the request rejects with a 401', async () => {
        requestToken.mockRejectedValue(unauthorized());

        await expect(restoreSession(queryClient)).resolves.toBe(false);
        expect(getSession().accessToken).toBeUndefined();
    });

    it.each(['invalid_request', 'invalid_token', 'invalid_grant'])('reads the station refusing with %s as anonymous, and caches it', async code => {
        // `invalid_request` is a browser with no cookie at all, which is every first visit.
        requestToken.mockRejectedValue(unauthorized(code));

        await expect(restoreSession(queryClient)).resolves.toBe(false);
        await restoreSession(queryClient);

        expect(requestToken).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['its own rate limiter', 429, {}],
        ['a request timeout', 408, {}],
        ['a WAF', 403, {}],
        ['a proxy missing the route', 404, {}],
        ['a proxy challenging for its own login', 401, { 'WWW-Authenticate': 'Basic realm="tunnel"' }],
        ['a proxy that names no error', 401, { 'WWW-Authenticate': 'Bearer realm="tunnel"' }],
    ])('caches no verdict on a refusal from %s, so the cookie gets another go', async (_who, status, headers) => {
        requestToken.mockRejectedValueOnce(new SdkError(status, 'Refused', undefined, new Headers(headers)));
        requestToken.mockResolvedValueOnce({ result: 'token', access_token: 'tok-1', expires_in: 3600 });

        await expect(restoreSession(queryClient)).resolves.toBe(false);
        await expect(restoreSession(queryClient)).resolves.toBe(true);

        expect(requestToken).toHaveBeenCalledTimes(2);
        expect(getSession().accessToken).toBe('tok-1');
    });

    it('makes the call once across concurrent and repeat invocations, then again after reset', async () => {
        requestToken.mockResolvedValue({ result: 'token', access_token: 'tok-1', expires_in: 3600 });

        const [first, second] = await Promise.all([restoreSession(queryClient), restoreSession(queryClient)]);
        await restoreSession(queryClient);

        expect(first).toBe(true);
        expect(second).toBe(true);
        expect(requestToken).toHaveBeenCalledTimes(1);

        resetSessionBootstrap(queryClient);
        clearSession();
        await restoreSession(queryClient);

        expect(requestToken).toHaveBeenCalledTimes(2);
    });

    it('answers repeat gate evaluations from a cached 401 rather than retrying in a loop', async () => {
        requestToken.mockRejectedValue(unauthorized());

        await restoreSession(queryClient);
        await restoreSession(queryClient);
        await restoreSession(queryClient);

        expect(requestToken).toHaveBeenCalledTimes(1);
    });

    it('answers from a live token without redeeming at all', async () => {
        setSession('tok-live', 3600);

        await expect(restoreSession(queryClient)).resolves.toBe(true);

        expect(requestToken).not.toHaveBeenCalled();
    });

    it('drops a dead token when the redeem is refused, so nothing downstream sends it', async () => {
        setSession('stale-token', 3600);
        // A live token short-circuits, so this is the case that actually reaches the API: the token
        // is present but already expired.
        vi.useFakeTimers();
        vi.setSystemTime(Date.now() + 3_600_001);
        requestToken.mockRejectedValue(unauthorized());

        await expect(restoreSession(queryClient)).resolves.toBe(false);

        expect(getSession().accessToken).toBeUndefined();
        // The clear it just performed is its own doing and must not re-arm the attempt.
        await restoreSession(queryClient);
        expect(requestToken).toHaveBeenCalledTimes(1);
    });

    it('does not cache an unreachable API, so the next gate evaluation tries again', async () => {
        requestToken.mockRejectedValue(new TypeError('Failed to fetch'));

        await expect(restoreSession(queryClient)).resolves.toBe(false);
        await expect(restoreSession(queryClient)).resolves.toBe(false);

        expect(requestToken).toHaveBeenCalledTimes(2);
    });

    it('does not cache a 5xx either: the server answered about itself, not about the cookie', async () => {
        requestToken.mockRejectedValue(serverError());

        await restoreSession(queryClient);
        await restoreSession(queryClient);

        expect(requestToken).toHaveBeenCalledTimes(2);
    });

    it('recovers on its own once connectivity returns, with no reset or reload', async () => {
        requestToken.mockRejectedValue(new TypeError('Failed to fetch'));
        await expect(restoreSession(queryClient)).resolves.toBe(false);

        requestToken.mockResolvedValue({ result: 'token', access_token: 'tok-1', expires_in: 3600 });

        await expect(restoreSession(queryClient)).resolves.toBe(true);
        expect(getSession().accessToken).toBe('tok-1');
    });

    it('leaves a live session in place when the redeem cannot reach the API', async () => {
        setSession('tok-live', 3600);
        vi.useFakeTimers();
        // Expired, so the redeem actually runs; the token itself is still in the store.
        vi.setSystemTime(Date.now() + 3_600_001);
        requestToken.mockRejectedValue(new TypeError('Failed to fetch'));

        await restoreSession(queryClient);

        expect(getSession().accessToken).toBe('tok-live');
    });

    it('still shares one in-flight redeem across concurrent callers when it fails transiently', async () => {
        requestToken.mockRejectedValue(new TypeError('Failed to fetch'));

        const [first, second] = await Promise.all([restoreSession(queryClient), restoreSession(queryClient)]);

        expect(first).toBe(false);
        expect(second).toBe(false);
        expect(requestToken).toHaveBeenCalledTimes(1);
    });

    it('redeems the cookie after a sign-in instead of replaying a rejection cached before it', async () => {
        vi.useFakeTimers();
        // A fresh tab boots at /login: there is no cookie yet, so the boot redeem is refused and the
        // verdict "anonymous" is cached. Nothing is cleared, so only `setSession` can retire it.
        requestToken.mockRejectedValue(unauthorized());
        await expect(restoreSession(queryClient)).resolves.toBe(false);
        expect(requestToken).toHaveBeenCalledTimes(1);

        // The user signs in. The server sets a fresh refresh cookie; the SPA sees only the token.
        setSession('tok-login', 3600);

        // An hour on, the access token has expired and the next navigation re-evaluates the gate.
        vi.setSystemTime(Date.now() + 3_600_001);
        expect(isAuthenticated()).toBe(false);
        requestToken.mockResolvedValue({ result: 'token', access_token: 'tok-refreshed', expires_in: 3600 });

        // The cookie the user earned by signing in gets its turn, rather than the stale rejection
        // standing in for it and stranding them back at /login.
        await expect(restoreSession(queryClient)).resolves.toBe(true);

        expect(requestToken).toHaveBeenCalledTimes(2);
        expect(getSession().accessToken).toBe('tok-refreshed');
        expect(isAuthenticated()).toBe(true);
    });

    it('settles after the redeem that a sign-in re-armed, rather than re-arming on its own success', async () => {
        vi.useFakeTimers();
        requestToken.mockRejectedValue(unauthorized());
        await restoreSession(queryClient);

        setSession('tok-login', 3600);
        vi.setSystemTime(Date.now() + 3_600_001);
        requestToken.mockResolvedValue({ result: 'token', access_token: 'tok-refreshed', expires_in: 3600 });

        // The sign-in re-arms the cache once; the redeem it allows stores a token of its own, and that
        // self-inflicted change must not re-arm the verdict that caused it.
        await restoreSession(queryClient);
        await restoreSession(queryClient);
        await restoreSession(queryClient);

        expect(requestToken).toHaveBeenCalledTimes(2);
    });

    it('redeems again once the token it handed back has expired', async () => {
        vi.useFakeTimers();
        requestToken.mockResolvedValue({ result: 'token', access_token: 'tok-1', expires_in: 3600 });

        await restoreSession(queryClient);
        expect(requestToken).toHaveBeenCalledTimes(1);

        vi.setSystemTime(Date.now() + 3_600_001);
        requestToken.mockResolvedValue({ result: 'token', access_token: 'tok-2', expires_in: 3600 });

        await expect(restoreSession(queryClient)).resolves.toBe(true);

        expect(requestToken).toHaveBeenCalledTimes(2);
        expect(getSession().accessToken).toBe('tok-2');
    });
});
