import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigFieldDescriptor } from '@deadair/sdk';

import { columnSuggestionKey, useDeclaredOptions } from '../../../src/components/settings/declared.options';
import { createTestQueryClient } from '../../utils/render';
import { pluginSummary } from '../../utils/plugin.fixture';

const listPlugins = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        plugins: {
            listPlugins: (...args: unknown[]) => listPlugins(...args),
        },
    },
}));

afterEach(() => {
    listPlugins.mockReset();
});

function wrapWithQueryClient(queryClient: QueryClient) {
    return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);
}

/** A minimal descriptor: only the fields `useDeclaredOptions` reads. */
function stringField(overrides: Partial<ConfigFieldDescriptor> = {}): ConfigFieldDescriptor {
    return { key: 'a.field', label: 'A field', type: 'string', ...overrides };
}

describe('useDeclaredOptions', () => {
    it('fetches nothing and answers no options for a form that declares no source', () => {
        const queryClient = createTestQueryClient();

        const { result } = renderHook(() => useDeclaredOptions([stringField()]), { wrapper: wrapWithQueryClient(queryClient) });

        expect(result.current).toEqual({});
        expect(listPlugins).not.toHaveBeenCalled();
    });

    it('does not fetch the plugin list for a form that wants only the station-table sources', () => {
        const queryClient = createTestQueryClient();
        const fields = [stringField({ key: 'station.newsCategories', optionsFrom: 'station.newsCategories' })];

        renderHook(() => useDeclaredOptions(fields), { wrapper: wrapWithQueryClient(queryClient) });

        expect(listPlugins).not.toHaveBeenCalled();
    });

    it.each(['plugins.speech', 'plugins.llm', 'plugins.mixer', 'plugins.analysis'] as const)(
        'resolves %s to the enabled plugins declaring the matching capability, as {value, label}',
        async source => {
            const queryClient = createTestQueryClient();
            const capability = source.split('.')[1]!;
            listPlugins.mockResolvedValue([
                pluginSummary({ id: 'match', name: 'Match', enabled: true, capabilities: [capability] }),
                pluginSummary({ id: 'disabled', name: 'Disabled', enabled: false, capabilities: [capability] }),
                pluginSummary({ id: 'other-capability', name: 'Other', enabled: true, capabilities: ['catalog'] }),
            ]);
            const fields = [stringField({ key: 'the.setting', optionsFrom: source })];

            const { result } = renderHook(() => useDeclaredOptions(fields), { wrapper: wrapWithQueryClient(queryClient) });

            await waitFor(() => expect(result.current['the.setting']).toEqual([{ value: 'match', label: 'Match' }]));
            expect(listPlugins).toHaveBeenCalledTimes(1);
        },
    );

    it('fetches the plugin list once for a form that wants two different plugins.* sources', async () => {
        const queryClient = createTestQueryClient();
        listPlugins.mockResolvedValue([pluginSummary({ id: 'speaker', name: 'Speaker', enabled: true, capabilities: ['speech'] })]);
        const fields = [
            stringField({ key: 'speech.plugin', optionsFrom: 'plugins.speech' }),
            stringField({ key: 'llm.plugin', optionsFrom: 'plugins.llm' }),
        ];

        const { result } = renderHook(() => useDeclaredOptions(fields), { wrapper: wrapWithQueryClient(queryClient) });

        await waitFor(() => expect(result.current['speech.plugin']).toEqual([{ value: 'speaker', label: 'Speaker' }]));
        expect(result.current['llm.plugin']).toEqual([]);
        expect(listPlugins).toHaveBeenCalledTimes(1);
    });

    it("resolves a column's own optionsFrom under its dotted suggestion key", async () => {
        const queryClient = createTestQueryClient();
        listPlugins.mockResolvedValue([pluginSummary({ id: 'mixer-a', name: 'Mixer A', enabled: true, capabilities: ['mixer'] })]);
        const fields: ConfigFieldDescriptor[] = [
            {
                key: 'voices',
                label: 'Voices',
                type: 'list',
                columns: [{ key: 'engine', label: 'Engine', type: 'select', optionsFrom: 'plugins.mixer' }],
            },
        ];

        const { result } = renderHook(() => useDeclaredOptions(fields), { wrapper: wrapWithQueryClient(queryClient) });

        await waitFor(() => expect(result.current[columnSuggestionKey('voices', 'engine')]).toEqual([{ value: 'mixer-a', label: 'Mixer A' }]));
    });
});
