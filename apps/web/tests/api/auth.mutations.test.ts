import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { usePasskeySignInMutation } from '../../src/api/auth.mutations';
import { clearSession, getSession } from '../../src/auth/session.store';
import { createTestQueryClient } from '../utils/render';

const startLogin = vi.fn();
const requestToken = vi.fn();

vi.mock('../../src/api/client', () => ({
    sdk: {
        authentication: {
            startLogin: (...args: unknown[]) => startLogin(...args),
            requestToken: (...args: unknown[]) => requestToken(...args),
        },
    },
}));

const SIGNED_ASSERTION = vi.hoisted(() => ({
    id: 'cred-1',
    rawId: 'cred-1',
    type: 'public-key',
    response: { clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA' },
}));
vi.mock('../../src/auth/webauthn', async importOriginal => ({
    ...(await importOriginal<typeof import('../../src/auth/webauthn')>()),
    assertPasskey: async () => SIGNED_ASSERTION,
}));

afterEach(() => {
    startLogin.mockReset();
    requestToken.mockReset();
    clearSession();
});

function wrapWithQueryClient(queryClient: QueryClient) {
    return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('usePasskeySignInMutation', () => {
    it('sends the signed credential as JSON, because form encoding flattens it to "[object Object]"', async () => {
        startLogin.mockResolvedValue({ grant_type: 'fido', challengeId: 'fido-1', assertion: { challenge: 'abc' } });
        requestToken.mockResolvedValue({ result: 'token', access_token: 'tok-1', expires_in: 900 });
        const { result } = renderHook(() => usePasskeySignInMutation(), { wrapper: wrapWithQueryClient(createTestQueryClient()) });

        await act(() => result.current.mutateAsync({ email: ' dj@example.com ' }));

        expect(startLogin).toHaveBeenCalledWith({ grant_type: 'fido', email: 'dj@example.com' });
        expect(requestToken).toHaveBeenCalledWith(
            { grant_type: 'fido', challenge_id: 'fido-1', credential: SIGNED_ASSERTION },
            { contentType: 'application/json' },
        );
        expect(getSession().accessToken).toBe('tok-1');
    });
});
