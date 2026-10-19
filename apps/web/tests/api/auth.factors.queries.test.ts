import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    presentableFactors,
    strongFactors,
    useMfaCodeMutation,
    usePasskeyChallengeMutation,
    useRegisterAuthenticator,
    useRemoveFactor,
    useStartStepUp,
    useVerifyAuthenticator,
} from '../../src/api/auth.factors.queries';
import { queryKeys } from '../../src/api/query.keys';
import { generateCodeChallenge } from '../../src/auth/pkce';
import { clearSession, getSession } from '../../src/auth/session.store';
import { createTestQueryClient } from '../utils/render';

const registerFactor = vi.fn();
const verifyFactorRegistration = vi.fn();
const removeFactor = vi.fn();
const startMFAChallenge = vi.fn();
const startFactorChallenge = vi.fn();
const requestToken = vi.fn();

vi.mock('../../src/api/client', () => ({
    sdk: {
        authentication: {
            requestToken: (...args: unknown[]) => requestToken(...args),
            factors: {
                registerFactor: (...args: unknown[]) => registerFactor(...args),
                verifyFactorRegistration: (...args: unknown[]) => verifyFactorRegistration(...args),
                removeFactor: (...args: unknown[]) => removeFactor(...args),
                startMFAChallenge: (...args: unknown[]) => startMFAChallenge(...args),
                startFactorChallenge: (...args: unknown[]) => startFactorChallenge(...args),
            },
        },
    },
}));

afterEach(() => {
    for (const mock of [registerFactor, verifyFactorRegistration, removeFactor, startMFAChallenge, startFactorChallenge, requestToken])
        mock.mockReset();
    clearSession();
});

function wrapWithQueryClient(queryClient: QueryClient) {
    return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);
}

const REGISTRATION = {
    method: 'authenticator',
    registrationId: 'reg-1',
    secret: 'JBSWY3DP',
    uri: 'otpauth://totp/x',
    qrCode: 'data:image/png;base64,AA==',
};

describe('useRegisterAuthenticator', () => {
    it('sends a challenge derived from the verifier it hands back, and the label only when there is one', async () => {
        registerFactor.mockResolvedValue(REGISTRATION);
        const { result } = renderHook(() => useRegisterAuthenticator(), { wrapper: wrapWithQueryClient(createTestQueryClient()) });

        const registration = await act(() => result.current.mutateAsync({ label: '  Phone ' }));

        const sent = registerFactor.mock.calls[0]?.[0] as { method: string; codeChallenge: string; label?: string };
        expect(sent.method).toBe('authenticator');
        expect(sent.label).toBe('Phone');
        // The verifier never leaves the browser; only its hash does, and the two must agree.
        expect(sent.codeChallenge).toBe(generateCodeChallenge(registration.codeVerifier));
        expect(registration).toMatchObject({ registrationId: 'reg-1', secret: 'JBSWY3DP', qrCode: REGISTRATION.qrCode });
    });

    it('leaves the label out entirely when it was blank', async () => {
        registerFactor.mockResolvedValue(REGISTRATION);
        const { result } = renderHook(() => useRegisterAuthenticator(), { wrapper: wrapWithQueryClient(createTestQueryClient()) });

        await act(() => result.current.mutateAsync({ label: '   ' }));

        expect(registerFactor.mock.calls[0]?.[0]).not.toHaveProperty('label');
    });
});

describe('useVerifyAuthenticator', () => {
    it('stores the token it is answered with and drops the cached factor list', async () => {
        verifyFactorRegistration.mockResolvedValue({ access_token: 'tok-2', expires_in: 900, token_type: 'Bearer', scope: '' });
        const queryClient = createTestQueryClient();
        queryClient.setQueryData(queryKeys.auth.factors(), []);
        const { result } = renderHook(() => useVerifyAuthenticator(), { wrapper: wrapWithQueryClient(queryClient) });

        await act(() => result.current.mutateAsync({ registrationId: 'reg-1', code: '123456', codeVerifier: 'v'.repeat(43) }));

        expect(verifyFactorRegistration).toHaveBeenCalledWith({
            method: 'authenticator',
            registrationId: 'reg-1',
            code: '123456',
            codeVerifier: 'v'.repeat(43),
        });
        expect(getSession().accessToken).toBe('tok-2');
        await waitFor(() => {
            expect(queryClient.getQueryState(queryKeys.auth.factors())?.isInvalidated).toBe(true);
        });
    });
});

describe('useRemoveFactor', () => {
    it('names the method and id positionally, as the route does, and drops the cached list', async () => {
        removeFactor.mockResolvedValue(undefined);
        const queryClient = createTestQueryClient();
        queryClient.setQueryData(queryKeys.auth.factors(), []);
        const { result } = renderHook(() => useRemoveFactor(), { wrapper: wrapWithQueryClient(queryClient) });

        await act(() => result.current.mutateAsync({ method: 'authenticator', methodId: 'totp-1' }));

        expect(removeFactor).toHaveBeenCalledWith('authenticator', 'totp-1');
        await waitFor(() => {
            expect(queryClient.getQueryState(queryKeys.auth.factors())?.isInvalidated).toBe(true);
        });
    });
});

describe('useMfaCodeMutation', () => {
    it('submits the code against the challenge and factor it was given, and stores the token', async () => {
        requestToken.mockResolvedValue({ result: 'token', access_token: 'tok-3', expires_in: 900 });
        const { result } = renderHook(() => useMfaCodeMutation(), { wrapper: wrapWithQueryClient(createTestQueryClient()) });

        await act(() => result.current.mutateAsync({ challengeId: 'mfa-1', methodId: 'totp-1', code: '654321' }));

        expect(requestToken).toHaveBeenCalledWith({ grant_type: 'authenticator', mfa_challenge_id: 'mfa-1', method_id: 'totp-1', code: '654321' });
        expect(getSession().accessToken).toBe('tok-3');
    });

    it('stores nothing when the API asks for yet another factor', async () => {
        requestToken.mockResolvedValue({ result: 'mfa_required', challenge_id: 'mfa-2', factors: [] });
        const { result } = renderHook(() => useMfaCodeMutation(), { wrapper: wrapWithQueryClient(createTestQueryClient()) });

        const response = await act(() => result.current.mutateAsync({ challengeId: 'mfa-1', methodId: 'totp-1', code: '654321' }));

        expect(response.result).toBe('mfa_required');
        expect(getSession().accessToken).toBeUndefined();
    });
});

describe('useStartStepUp', () => {
    it('asks for a challenge this console can present, which is an authenticator', async () => {
        startMFAChallenge.mockResolvedValue({ result: 'mfa_required', challenge_id: 'mfa-9', factors: [] });
        const { result } = renderHook(() => useStartStepUp(), { wrapper: wrapWithQueryClient(createTestQueryClient()) });

        await act(() => result.current.mutateAsync());

        expect(startMFAChallenge).toHaveBeenCalledWith({ acceptableMethods: ['authenticator'] });
    });
});

const passkeyAvailable = vi.hoisted(() => ({ value: false }));
vi.mock('../../src/auth/webauthn', async importOriginal => ({
    ...(await importOriginal<typeof import('../../src/auth/webauthn')>()),
    passkeysAvailable: () => passkeyAvailable.value,
    assertPasskey: async () => SIGNED_ASSERTION,
}));

const SIGNED_ASSERTION = vi.hoisted(() => ({
    id: 'cred-1',
    rawId: 'cred-1',
    type: 'public-key',
    response: { clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA' },
}));

describe('usePasskeyChallengeMutation', () => {
    it('sends the signed credential as JSON, because form encoding flattens it to "[object Object]"', async () => {
        startFactorChallenge.mockResolvedValue({ method: 'fido', fido_challenge_id: 'fido-1', assertion: { challenge: 'abc' } });
        requestToken.mockResolvedValue({ result: 'token', access_token: 'tok-5', expires_in: 900 });
        const { result } = renderHook(() => usePasskeyChallengeMutation(), { wrapper: wrapWithQueryClient(createTestQueryClient()) });

        await act(() => result.current.mutateAsync({ challengeId: 'mfa-1' }));

        expect(requestToken).toHaveBeenCalledWith(
            { grant_type: 'fido', mfa_challenge_id: 'mfa-1', challenge_id: 'fido-1', credential: SIGNED_ASSERTION },
            { contentType: 'application/json' },
        );
        expect(getSession().accessToken).toBe('tok-5');
    });
});

const MIXED = {
    challengeId: 'mfa-1',
    factors: [
        { method: 'email' as const, method_id: 'email-1', kind: 'possession' as const },
        { method: 'authenticator' as const, method_id: 'totp-1', kind: 'possession' as const, label: 'Phone' },
        { method: 'fido' as const, method_id: 'key-1', kind: 'possession' as const },
    ],
};

describe('strongFactors', () => {
    afterEach(() => {
        passkeyAvailable.value = false;
    });

    it('keeps the authenticators, and no passkey where this browser cannot use one', () => {
        expect(strongFactors(MIXED).map(factor => factor.method_id)).toEqual(['totp-1']);
    });

    it('offers a passkey first where the browser can use one, and never an emailed code', () => {
        passkeyAvailable.value = true;
        expect(strongFactors(MIXED).map(factor => factor.method_id)).toEqual(['key-1', 'totp-1']);
    });
});

describe('presentableFactors', () => {
    afterEach(() => {
        passkeyAvailable.value = false;
    });

    it('orders a passkey, then an authenticator, then email', () => {
        passkeyAvailable.value = true;
        expect(presentableFactors(MIXED).map(factor => factor.method)).toEqual(['fido', 'authenticator', 'email']);
    });

    it('leaves the passkey out on a station opened over plain http', () => {
        expect(presentableFactors(MIXED).map(factor => factor.method)).toEqual(['authenticator', 'email']);
    });
});
