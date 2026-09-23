// Saving settings. The response is written straight into the cache, and the readings that depend on
// what was saved are asked again, because the station works those out and the form cannot.

import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUpdateSettings } from '../../src/api/settings.queries';
import { queryKeys } from '../../src/api/query.keys';
import { createTestQueryClient } from '../utils/render';

const updateSettings = vi.fn();

vi.mock('../../src/api/client', () => ({
    sdk: { settings: { updateSettings: (...args: unknown[]) => updateSettings(...args) } },
}));

afterEach(() => {
    updateSettings.mockReset();
});

const wrap =
    (queryClient: QueryClient) =>
    ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children);

describe('useUpdateSettings', () => {
    it('keeps what the station answered, and asks again for the provider order and the release check', async () => {
        const saved = { values: { 'station.checkForUpdates': 'false' } };
        updateSettings.mockResolvedValue(saved);
        const queryClient = createTestQueryClient();
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
        const { result } = renderHook(() => useUpdateSettings(), { wrapper: wrap(queryClient) });

        await act(() => result.current.mutateAsync({ 'station.checkForUpdates': 'false' }));

        expect(updateSettings).toHaveBeenCalledWith({ values: { 'station.checkForUpdates': 'false' } });
        expect(queryClient.getQueryData(queryKeys.settings.all())).toEqual(saved);
        expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.plugins.providers() });
        // Switching the check off hides the header's notice only if the console asks again rather
        // than waiting out its half-hourly poll.
        expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.station.releases() });
    });
});
