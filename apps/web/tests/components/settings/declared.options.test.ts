import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigFieldDescriptor } from '@deadair/sdk';

import { columnSuggestionKey, useDeclaredOptions } from '../../../src/components/settings/declared.options';
import { createTestQueryClient } from '../../utils/render';
import { pluginSummary } from '../../utils/plugin.fixture';

const listPlugins = vi.fn();
const listFeeds = vi.fn();
const suggestPluginConfigOptions = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        plugins: {
            listPlugins: (...args: unknown[]) => listPlugins(...args),
            suggestPluginConfigOptions: (...args: unknown[]) => suggestPluginConfigOptions(...args),
        },
        news: {
            listFeeds: (...args: unknown[]) => listFeeds(...args),
        },
    },
}));

afterEach(() => {
    listPlugins.mockReset();
    listFeeds.mockReset();
    suggestPluginConfigOptions.mockReset();
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

    it('does not fetch the feeds for a form that never asks for them', () => {
        const queryClient = createTestQueryClient();

        renderHook(() => useDeclaredOptions([stringField({ optionsFrom: 'intl.timeZones' })]), { wrapper: wrapWithQueryClient(queryClient) });

        expect(listFeeds).not.toHaveBeenCalled();
    });

    // The value is the qualified id because that is what the bulletin and the tool both ask for; the
    // label is the operator's own name for the feed, because that is the only form they have seen.
    it('resolves station.newsFeeds to the feeds the plugins currently offer', async () => {
        const queryClient = createTestQueryClient();
        listFeeds.mockResolvedValue({
            feeds: [
                { id: 'deadair.rss:world', pluginId: 'deadair.rss', name: 'World news' },
                { id: 'deadair.rss:sport', pluginId: 'deadair.rss', name: 'Sport' },
            ],
        });

        const fields = [
            stringField({
                key: 'rotation.newsFeeds',
                type: 'list',
                columns: [{ key: 'feed', label: 'Feed', type: 'select', optionsFrom: 'station.newsFeeds' }],
            }),
        ];
        const { result } = renderHook(() => useDeclaredOptions(fields), { wrapper: wrapWithQueryClient(queryClient) });

        await waitFor(() =>
            expect(result.current[columnSuggestionKey('rotation.newsFeeds', 'feed')]).toEqual([
                { value: 'deadair.rss:world', label: 'World news' },
                { value: 'deadair.rss:sport', label: 'Sport' },
            ]),
        );
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

describe('the models a writer can be set to', () => {
    const modelField = (): ConfigFieldDescriptor => ({ key: 'llm.breakModel', label: 'Model', type: 'string', optionsFrom: 'llm.models' });
    const pluginField = (): ConfigFieldDescriptor => ({ key: 'llm.pluginId', label: 'Think with', type: 'string', optionsFrom: 'plugins.llm' });

    const MODELS = [
        { value: 'gpt-oss-radio:latest', label: 'gpt-oss-radio:latest' },
        { value: 'anthropic:claude-x', label: 'claude-x · Anthropic' },
    ];

    function drawWith(valueOf: (key: string) => string | undefined) {
        const queryClient = createTestQueryClient();
        return renderHook(() => useDeclaredOptions([pluginField(), modelField()], valueOf), { wrapper: wrapWithQueryClient(queryClient) });
    }

    it('offers what the named plugin says it has, qualified as the plugin qualified it', async () => {
        listPlugins.mockResolvedValue([pluginSummary({ id: 'deadair.llm', capabilities: ['llm'], enabled: true })]);
        suggestPluginConfigOptions.mockResolvedValue({ fields: { model: MODELS }, supported: true });

        const { result } = drawWith(key => (key === 'llm.pluginId' ? 'deadair.llm' : undefined));

        await waitFor(() => expect(result.current['llm.breakModel']).toEqual(MODELS));
        expect(suggestPluginConfigOptions).toHaveBeenCalledWith('deadair.llm');
    });

    it('asks the plugin the station would actually reach when the setting is empty', async () => {
        // `selectPlugin`'s own rule, host-side: an unset key takes the first candidate by id. Asking
        // a different plugin than the station will use would offer models it cannot reach.
        listPlugins.mockResolvedValue([
            pluginSummary({ id: 'aaa.llm', capabilities: ['llm'], enabled: true }),
            pluginSummary({ id: 'zzz.llm', capabilities: ['llm'], enabled: true }),
        ]);
        suggestPluginConfigOptions.mockResolvedValue({ fields: { model: MODELS }, supported: true });

        const { result } = drawWith(() => '');

        await waitFor(() => expect(result.current['llm.breakModel']).toEqual(MODELS));
        expect(suggestPluginConfigOptions).toHaveBeenCalledWith('aaa.llm');
    });

    it('answers nothing rather than failing when the plugin has nothing to say', async () => {
        // An unreachable model server is a form with no suggestions on that field, not a settings
        // page that will not draw.
        listPlugins.mockResolvedValue([pluginSummary({ id: 'deadair.llm', capabilities: ['llm'], enabled: true })]);
        suggestPluginConfigOptions.mockResolvedValue({ fields: {}, supported: true });

        const { result } = drawWith(() => 'deadair.llm');

        await waitFor(() => expect(result.current['llm.breakModel']).toEqual([]));
    });

    it('asks nothing at all when no llm plugin is installed', async () => {
        listPlugins.mockResolvedValue([]);

        const { result } = drawWith(() => '');

        await waitFor(() => expect(result.current['llm.breakModel']).toEqual([]));
        expect(suggestPluginConfigOptions).not.toHaveBeenCalled();
    });

    it('asks nothing for a form with no model field in it', async () => {
        listPlugins.mockResolvedValue([pluginSummary({ id: 'deadair.llm', capabilities: ['llm'], enabled: true })]);
        const queryClient = createTestQueryClient();

        renderHook(() => useDeclaredOptions([pluginField()], () => 'deadair.llm'), { wrapper: wrapWithQueryClient(queryClient) });

        await waitFor(() => expect(listPlugins).toHaveBeenCalled());
        expect(suggestPluginConfigOptions).not.toHaveBeenCalled();
    });
});
