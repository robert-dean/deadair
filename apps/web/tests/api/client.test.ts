import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SdkFetch } from '@deadair/sdk';

import '../../src/api/client';
import { setSessionRefresher } from '../../src/auth/session.refresher';
import { clearSession, getSession, isAuthenticated, setSession } from '../../src/auth/session.store';

// The SDK is replaced wholesale so the transport can be driven by hand: `createSdkFetch` yields a
// controllable base fetch, and the client's own `sessionAwareFetch` is captured off the constructor.
const mocks = vi.hoisted(() => {
    class SdkErrorStub extends Error {
        readonly status: number;
        readonly body: unknown;
        readonly headers: Headers;

        constructor(status: number, body?: unknown) {
            super(`sdk error ${status}`);
            this.status = status;
            this.body = body;
            this.headers = new Headers();
        }
    }

    return {
        SdkErrorStub,
        baseFetch: vi.fn(),
        captured: { fetch: undefined as SdkFetch | undefined },
    };
});

vi.mock('@deadair/sdk', () => ({
    SdkError: mocks.SdkErrorStub,
    createSdkFetch: () => (url: string, init: RequestInit) => mocks.baseFetch(url, init) as Promise<Response>,
    DeadairSdk: class {
        constructor(options: { fetch?: SdkFetch }) {
            mocks.captured.fetch = options.fetch;
        }
    },
}));

/** The wrapper the client installed on the SDK, i.e. the thing under test. */
function sessionAwareFetch(): SdkFetch {
    if (!mocks.captured.fetch) {
        throw new Error('api/client did not install a session-aware fetch');
    }
    return mocks.captured.fetch;
}

/** Stands in for the refresh-cookie redeem, so the wrapper can be exercised without the bootstrap. */
const refresh = vi.fn<() => Promise<boolean>>();

beforeEach(() => {
    setSession('tok-1', 3600);
    setSessionRefresher(refresh);
});

afterEach(() => {
    mocks.baseFetch.mockReset();
    refresh.mockReset();
    setSessionRefresher(undefined);
    clearSession();
});

describe('api/client session-aware fetch', () => {
    it('passes a successful response through untouched', async () => {
        const response = { ok: true } as Response;
        mocks.baseFetch.mockResolvedValue(response);

        await expect(sessionAwareFetch()('/api/anything', {})).resolves.toBe(response);
        expect(refresh).not.toHaveBeenCalled();
        expect(isAuthenticated()).toBe(true);
    });

    it('leaves the session alone for a non-401 failure', async () => {
        mocks.baseFetch.mockRejectedValue(new mocks.SdkErrorStub(500));

        await expect(sessionAwareFetch()('/api/anything', {})).rejects.toBeInstanceOf(mocks.SdkErrorStub);

        expect(refresh).not.toHaveBeenCalled();
        expect(getSession().accessToken).toBe('tok-1');
    });

    it('leaves the session alone for a rejection that is not an SdkError at all', async () => {
        mocks.baseFetch.mockRejectedValue(new TypeError('network down'));

        await expect(sessionAwareFetch()('/api/anything', {})).rejects.toBeInstanceOf(TypeError);

        expect(refresh).not.toHaveBeenCalled();
        expect(isAuthenticated()).toBe(true);
    });

    it('redeems the refresh cookie on a 401 and replays the original request once', async () => {
        const replayed = { ok: true } as Response;
        mocks.baseFetch.mockRejectedValueOnce(new mocks.SdkErrorStub(401)).mockResolvedValueOnce(replayed);
        refresh.mockResolvedValue(true);

        const init = { method: 'POST', body: '{"a":1}' };
        await expect(sessionAwareFetch()('/anything', init)).resolves.toBe(replayed);

        expect(refresh).toHaveBeenCalledTimes(1);
        expect(mocks.baseFetch).toHaveBeenCalledTimes(2);
        // The replay re-issues the identical request; every SDK body is a string, so this is sound.
        expect(mocks.baseFetch).toHaveBeenNthCalledWith(2, '/anything', init);
    });

    it('clears the session and rethrows when the refresh cookie cannot be redeemed', async () => {
        mocks.baseFetch.mockRejectedValue(new mocks.SdkErrorStub(401));
        refresh.mockResolvedValue(false);

        await expect(sessionAwareFetch()('/anything', {})).rejects.toBeInstanceOf(mocks.SdkErrorStub);

        expect(refresh).toHaveBeenCalledTimes(1);
        // Only the original attempt: a failed redeem must not replay.
        expect(mocks.baseFetch).toHaveBeenCalledTimes(1);
        expect(getSession().accessToken).toBeUndefined();
    });

    it('replays at most once, clearing the session when the replay is also rejected', async () => {
        mocks.baseFetch.mockRejectedValue(new mocks.SdkErrorStub(401));
        refresh.mockResolvedValue(true);

        await expect(sessionAwareFetch()('/anything', {})).rejects.toBeInstanceOf(mocks.SdkErrorStub);

        expect(mocks.baseFetch).toHaveBeenCalledTimes(2);
        // No second redeem: the recovery path is not re-entered.
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(getSession().accessToken).toBeUndefined();
    });

    it.each(['/auth/token', '/auth/logout'])('does not try to redeem a 401 from %s', async url => {
        mocks.baseFetch.mockRejectedValue(new mocks.SdkErrorStub(401));

        await expect(sessionAwareFetch()(url, {})).rejects.toBeInstanceOf(mocks.SdkErrorStub);

        // The redeem *is* the token call, so refreshing here would recurse.
        expect(refresh).not.toHaveBeenCalled();
        expect(mocks.baseFetch).toHaveBeenCalledTimes(1);
        expect(getSession().accessToken).toBeUndefined();
    });

    it('treats a query string on an exempt path as still exempt', async () => {
        mocks.baseFetch.mockRejectedValue(new mocks.SdkErrorStub(401));

        await expect(sessionAwareFetch()('/auth/token?foo=1', {})).rejects.toBeInstanceOf(mocks.SdkErrorStub);

        expect(refresh).not.toHaveBeenCalled();
    });

    it('falls back to clearing the session when no refresher is installed', async () => {
        setSessionRefresher(undefined);
        mocks.baseFetch.mockRejectedValue(new mocks.SdkErrorStub(401));

        await expect(sessionAwareFetch()('/anything', {})).rejects.toBeInstanceOf(mocks.SdkErrorStub);

        expect(getSession().accessToken).toBeUndefined();
    });
});
