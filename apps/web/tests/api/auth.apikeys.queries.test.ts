import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCreateApiKey, useRevokeApiKey, useRotateApiKey } from '../../src/api/auth.apikeys.queries';
import { queryKeys } from '../../src/api/query.keys';
import { createTestQueryClient } from '../utils/render';

const createAPIKey = vi.fn();
const rotateAPIKey = vi.fn();
const revokeAPIKey = vi.fn();

vi.mock('../../src/api/client', () => ({
    sdk: {
        authentication: {
            apikeys: {
                createAPIKey: (...args: unknown[]) => createAPIKey(...args),
                rotateAPIKey: (...args: unknown[]) => rotateAPIKey(...args),
                revokeAPIKey: (...args: unknown[]) => revokeAPIKey(...args),
            },
        },
    },
}));

afterEach(() => {
    for (const mock of [createAPIKey, rotateAPIKey, revokeAPIKey]) mock.mockReset();
});

const wrap =
    (queryClient: QueryClient) =>
    ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children);

describe('the API key hooks', () => {
    it('sends a trimmed name, and refreshes the list once a key is issued', async () => {
        createAPIKey.mockResolvedValue({ key: { id: 'k-1' }, token: 'da_x' });
        const queryClient = createTestQueryClient();
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
        const { result } = renderHook(() => useCreateApiKey(), { wrapper: wrap(queryClient) });

        await act(() => result.current.mutateAsync({ name: '  Doorbell ', scopes: ['view'] }));

        expect(createAPIKey).toHaveBeenCalledWith({ name: 'Doorbell', scopes: ['view'] });
        expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.auth.apikeys() });
    });

    it('never retries an issue, which would mint a second key and lose the first token', async () => {
        createAPIKey.mockRejectedValue(new Error('network'));
        const { result } = renderHook(() => useCreateApiKey(), { wrapper: wrap(createTestQueryClient()) });

        await act(() => result.current.mutateAsync({ name: 'Doorbell', scopes: ['view'] }).catch(() => undefined));

        expect(createAPIKey).toHaveBeenCalledOnce();
    });

    it('rotates and revokes by id', async () => {
        rotateAPIKey.mockResolvedValue({ key: { id: 'k-1' }, token: 'da_y' });
        revokeAPIKey.mockResolvedValue(undefined);
        const client = createTestQueryClient();
        const rotate = renderHook(() => useRotateApiKey(), { wrapper: wrap(client) });
        const revoke = renderHook(() => useRevokeApiKey(), { wrapper: wrap(client) });

        await act(() => rotate.result.current.mutateAsync({ id: 'k-1' }));
        await act(() => revoke.result.current.mutateAsync({ id: 'k-1' }));

        expect(rotateAPIKey).toHaveBeenCalledWith('k-1');
        expect(revokeAPIKey).toHaveBeenCalledWith('k-1');
    });
});
