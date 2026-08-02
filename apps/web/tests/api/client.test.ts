import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SdkFetch } from '@deadair/sdk';

import '../../src/api/client';
import { resetSessionBootstrap, restoreSession } from '../../src/auth/session.bootstrap';
import { clearSession, getSession, isAuthenticated } from '../../src/auth/session.store';

// The SDK is replaced wholesale so the transport can be driven by hand: `createSdkFetch` yields a
// controllable base fetch, and the client's own `sessionAwareFetch` is captured off the constructor.
const mocks = vi.hoisted(() => {
    class SdkErrorStub extends Error {
        readonly status: number;
        readonly body: unknown;

        constructor(status: number, body?: unknown) {
            super(`sdk error ${status}`);
            this.status = status;
            this.body = body;
        }
    }

    return {
        SdkErrorStub,
        baseFetch: vi.fn(),
        requestToken: vi.fn(),
        captured: { fetch: undefined as SdkFetch | undefined },
    };
});

vi.mock('@deadair/sdk', () => ({
    SdkError: mocks.SdkErrorStub,
    createSdkFetch: () => (url: string, init: RequestInit) => mocks.baseFetch(url, init) as Promise<Response>,
    DeadairSdk: class {
        authentication = { requestToken: (...args: unknown[]) => mocks.requestToken(...args) };

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

async function signIn(): Promise<void> {
    mocks.requestToken.mockResolvedValue({ result: 'token', access_token: 'tok-1', expires_in: 3600 });
    await restoreSession();
}

afterEach(() => {
    mocks.baseFetch.mockReset();
    mocks.requestToken.mockReset();
    resetSessionBootstrap();
    clearSession();
});

describe('api/client session-aware fetch', () => {
    it('passes a successful response through untouched', async () => {
        await signIn();
        const response = { ok: true } as Response;
        mocks.baseFetch.mockResolvedValue(response);

        await expect(sessionAwareFetch()('/api/anything', {})).resolves.toBe(response);
        expect(isAuthenticated()).toBe(true);
    });

    it('clears the session and re-arms the bootstrap when any call comes back 401', async () => {
        await signIn();
        expect(mocks.requestToken).toHaveBeenCalledTimes(1);
        mocks.baseFetch.mockRejectedValue(new mocks.SdkErrorStub(401));

        await expect(sessionAwareFetch()('/api/anything', {})).rejects.toBeInstanceOf(mocks.SdkErrorStub);

        expect(getSession().accessToken).toBeUndefined();
        // The cached redeem must not be replayed: the refresh cookie gets another go.
        await restoreSession();
        expect(mocks.requestToken).toHaveBeenCalledTimes(2);
    });

    it('leaves the session and the cached redeem alone for a non-401 failure', async () => {
        await signIn();
        mocks.baseFetch.mockRejectedValue(new mocks.SdkErrorStub(500));

        await expect(sessionAwareFetch()('/api/anything', {})).rejects.toBeInstanceOf(mocks.SdkErrorStub);

        expect(getSession().accessToken).toBe('tok-1');
        expect(isAuthenticated()).toBe(true);
        await restoreSession();
        expect(mocks.requestToken).toHaveBeenCalledTimes(1);
    });

    it('leaves the session alone for a rejection that is not an SdkError at all', async () => {
        await signIn();
        mocks.baseFetch.mockRejectedValue(new TypeError('network down'));

        await expect(sessionAwareFetch()('/api/anything', {})).rejects.toBeInstanceOf(TypeError);

        expect(isAuthenticated()).toBe(true);
    });
});
