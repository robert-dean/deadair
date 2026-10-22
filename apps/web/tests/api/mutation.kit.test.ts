import { createElement, type ReactNode } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useListWrite, useSettledWrite } from '../../src/api/mutation.kit';
import { createTestQueryClient } from '../utils/render';

const wrapper =
    (queryClient: QueryClient) =>
    ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children);

describe('useListWrite', () => {
    it('writes the answer into the cache under the key, without refetching it', async () => {
        const queryClient = createTestQueryClient();
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
        const { result } = renderHook(() => useListWrite(['topics'], async (name: string) => ({ items: [name] })), { wrapper: wrapper(queryClient) });

        await act(() => result.current.mutateAsync('weather'));

        expect(queryClient.getQueryData(['topics'])).toEqual({ items: ['weather'] });
        expect(invalidate).not.toHaveBeenCalled();
    });

    it('works the key out from the answer for a list kept per parent', async () => {
        const queryClient = createTestQueryClient();
        const { result } = renderHook(
            () =>
                useListWrite(
                    (answer: { personaId: string }) => ['notes', answer.personaId],
                    async () => ({ personaId: 'p1', notes: [] }),
                ),
            { wrapper: wrapper(queryClient) },
        );

        await act(() => result.current.mutateAsync(undefined));

        expect(queryClient.getQueryData(['notes', 'p1'])).toEqual({ personaId: 'p1', notes: [] });
    });

    it('invalidates what the answer does not describe', async () => {
        const queryClient = createTestQueryClient();
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
        const { result } = renderHook(() => useListWrite(['topics'], async () => [], [['clock'], ['timetable']]), { wrapper: wrapper(queryClient) });

        await act(() => result.current.mutateAsync(undefined));

        expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([['clock'], ['timetable']]);
    });

    it('leaves the cache alone when the write fails', async () => {
        const queryClient = createTestQueryClient();
        queryClient.setQueryData(['topics'], ['kept']);
        const { result } = renderHook(() => useListWrite(['topics'], async () => Promise.reject(new Error('refused'))), {
            wrapper: wrapper(queryClient),
        });

        await act(() => result.current.mutateAsync(undefined).catch(() => undefined));

        expect(queryClient.getQueryData(['topics'])).toEqual(['kept']);
    });
});

describe('useSettledWrite', () => {
    it('refetches the list on success and on failure alike', async () => {
        const queryClient = createTestQueryClient();
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
        let fail = false;
        const { result } = renderHook(
            () =>
                useSettledWrite(['pads'], async () => {
                    if (fail) throw new Error('409');
                    return 'stored';
                }),
            { wrapper: wrapper(queryClient) },
        );

        await act(() => result.current.mutateAsync(undefined));
        fail = true;
        await act(() => result.current.mutateAsync(undefined).catch(() => undefined));

        expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([['pads'], ['pads']]);
    });

    it('does not write the answer into the cache', async () => {
        const queryClient = createTestQueryClient();
        const { result } = renderHook(() => useSettledWrite(['pads'], async () => ['answer']), { wrapper: wrapper(queryClient) });

        await act(() => result.current.mutateAsync(undefined));

        expect(queryClient.getQueryData(['pads'])).toBeUndefined();
    });
});
