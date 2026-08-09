import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';

import { completePluginOAuth, useSetPluginLogLevel, writePluginDetail } from '../../src/api/plugins.queries';
import { queryKeys } from '../../src/api/query.keys';
import { pluginDetail, pluginSummary } from '../utils/plugin.fixture';
import { createTestQueryClient } from '../utils/render';

const completePluginOAuthAuthorization = vi.fn();
const setPluginLogLevel = vi.fn();

vi.mock('../../src/api/client', () => ({
    sdk: {
        plugins: {
            completePluginOAuthAuthorization: (...args: unknown[]) => completePluginOAuthAuthorization(...args),
            setPluginLogLevel: (...args: unknown[]) => setPluginLogLevel(...args),
        },
    },
}));

afterEach(() => {
    completePluginOAuthAuthorization.mockReset();
    setPluginLogLevel.mockReset();
});

/** Wraps a hook under test with the same provider `render` uses, for a query client the test controls. */
function wrapWithQueryClient(queryClient: QueryClient) {
    return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('writePluginDetail', () => {
    it('files the response into the detail read and the matching list entry', () => {
        const queryClient = createTestQueryClient();
        queryClient.setQueryData(queryKeys.plugins.list(), [pluginSummary(), pluginSummary({ id: 'other', name: 'Other' })]);

        writePluginDetail(queryClient, pluginDetail({ enabled: false, status: 'disabled', config: { clientId: 'abc' } }));

        expect(queryClient.getQueryData(queryKeys.plugins.detail('deadair.spotify'))).toMatchObject({
            status: 'disabled',
            config: { clientId: 'abc' },
        });

        const list = queryClient.getQueryData(queryKeys.plugins.list()) as { id: string; status: string }[];
        expect(list.map(plugin => [plugin.id, plugin.status])).toEqual([
            ['deadair.spotify', 'disabled'],
            ['other', 'active'],
        ]);
        // The list carries summaries; the detail-only halves must not ride along into it.
        expect(list[0]).not.toHaveProperty('config');
        expect(list[0]).not.toHaveProperty('lastError');
    });

    it('leaves an uncached list alone rather than seeding a one-plugin catalogue', () => {
        const queryClient = createTestQueryClient();

        writePluginDetail(queryClient, pluginDetail());

        expect(queryClient.getQueryData(queryKeys.plugins.list())).toBeUndefined();
    });
});

describe('completePluginOAuth', () => {
    it('passes the callback parameters through once and drops the stale detail read', async () => {
        const queryClient = createTestQueryClient();
        queryClient.setQueryData(queryKeys.plugins.detail('deadair.spotify'), pluginDetail());
        completePluginOAuthAuthorization.mockResolvedValue({ pluginId: 'deadair.spotify', ok: true });

        const outcome = await completePluginOAuth(queryClient, 'deadair.spotify', { code: 'auth-code', state: 'st-1' });

        expect(outcome).toEqual({ result: { pluginId: 'deadair.spotify', ok: true } });
        expect(completePluginOAuthAuthorization).toHaveBeenCalledTimes(1);
        expect(completePluginOAuthAuthorization).toHaveBeenCalledWith('deadair.spotify', { code: 'auth-code', state: 'st-1' });
        expect(queryClient.getQueryState(queryKeys.plugins.detail('deadair.spotify'))?.isInvalidated).toBe(true);
    });

    it('turns a request that never landed into a sentence rather than a rejection', async () => {
        completePluginOAuthAuthorization.mockRejectedValue(
            new SdkError(503, 'Service Unavailable', { statusCode: 503, message: 'plugin host restarting' }, new Headers()),
        );

        const outcome = await completePluginOAuth(createTestQueryClient(), 'deadair.spotify', { state: 'st-1' });

        expect(outcome).toEqual({ failure: 'plugin host restarting' });
    });
});

describe('queryKeys.plugins.logs', () => {
    it('is a strict prefix of every filtered form', () => {
        const unfiltered = queryKeys.plugins.logs('deadair.spotify');
        const filtered = queryKeys.plugins.logs('deadair.spotify', { level: 'debug' });

        expect(filtered.slice(0, unfiltered.length)).toEqual(unfiltered);
        expect(filtered.length).toBeGreaterThan(unfiltered.length);
    });

    it('keys distinct filters apart from each other', () => {
        const byLevel = queryKeys.plugins.logs('deadair.spotify', { level: 'warn' });
        const byLimit = queryKeys.plugins.logs('deadair.spotify', { limit: 50 });
        const byBoth = queryKeys.plugins.logs('deadair.spotify', { level: 'warn', limit: 50 });

        expect(byLevel).not.toEqual(byLimit);
        expect(byLevel).not.toEqual(byBoth);
        expect(byLimit).not.toEqual(byBoth);
    });

    it('treats an explicit empty query as filtered, distinct from the no-argument form', () => {
        const noArgument = queryKeys.plugins.logs('deadair.spotify');
        const emptyQuery = queryKeys.plugins.logs('deadair.spotify', {});

        expect(noArgument).toEqual(['plugins', 'logs', 'deadair.spotify']);
        expect(emptyQuery).toEqual(['plugins', 'logs', 'deadair.spotify', 'all', 'all']);
        expect(emptyQuery).not.toEqual(noArgument);
    });

    it('keys different plugin ids apart from each other', () => {
        expect(queryKeys.plugins.logs('deadair.spotify')).not.toEqual(queryKeys.plugins.logs('other-plugin'));
    });
});

describe('useSetPluginLogLevel', () => {
    it('invalidates a cached log tail filtered to a non-default level', async () => {
        const queryClient = createTestQueryClient();
        const filteredKey = queryKeys.plugins.logs('deadair.spotify', { level: 'warn' });
        queryClient.setQueryData(filteredKey, { entries: [], nextCursor: undefined });
        setPluginLogLevel.mockResolvedValue(pluginDetail({ logLevel: 'warn' }));

        const { result } = renderHook(() => useSetPluginLogLevel('deadair.spotify'), { wrapper: wrapWithQueryClient(queryClient) });

        act(() => {
            result.current.mutate('warn');
        });

        await waitFor(() => expect(queryClient.getQueryState(filteredKey)?.isInvalidated).toBe(true));
    });

    it('invalidates the unfiltered tail too, since the id-only key is its prefix', async () => {
        const queryClient = createTestQueryClient();
        const unfilteredKey = queryKeys.plugins.logs('deadair.spotify');
        queryClient.setQueryData(unfilteredKey, { entries: [], nextCursor: undefined });
        setPluginLogLevel.mockResolvedValue(pluginDetail({ logLevel: 'debug' }));

        const { result } = renderHook(() => useSetPluginLogLevel('deadair.spotify'), { wrapper: wrapWithQueryClient(queryClient) });

        act(() => {
            result.current.mutate('debug');
        });

        await waitFor(() => expect(queryClient.getQueryState(unfilteredKey)?.isInvalidated).toBe(true));
    });

    it('invalidates every distinct filtered tail for the plugin in one call', async () => {
        const queryClient = createTestQueryClient();
        const byLevel = queryKeys.plugins.logs('deadair.spotify', { level: 'warn' });
        const byLimit = queryKeys.plugins.logs('deadair.spotify', { limit: 50 });
        queryClient.setQueryData(byLevel, { entries: [], nextCursor: undefined });
        queryClient.setQueryData(byLimit, { entries: [], nextCursor: undefined });
        setPluginLogLevel.mockResolvedValue(pluginDetail({ logLevel: 'debug' }));

        const { result } = renderHook(() => useSetPluginLogLevel('deadair.spotify'), { wrapper: wrapWithQueryClient(queryClient) });

        act(() => {
            result.current.mutate('debug');
        });

        await waitFor(() => {
            expect(queryClient.getQueryState(byLevel)?.isInvalidated).toBe(true);
            expect(queryClient.getQueryState(byLimit)?.isInvalidated).toBe(true);
        });
    });

    it("leaves a different plugin's cached log tail alone", async () => {
        const queryClient = createTestQueryClient();
        const otherPluginKey = queryKeys.plugins.logs('other-plugin', { level: 'warn' });
        queryClient.setQueryData(otherPluginKey, { entries: [], nextCursor: undefined });
        setPluginLogLevel.mockResolvedValue(pluginDetail({ logLevel: 'debug' }));

        const { result } = renderHook(() => useSetPluginLogLevel('deadair.spotify'), { wrapper: wrapWithQueryClient(queryClient) });

        act(() => {
            result.current.mutate('debug');
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(queryClient.getQueryState(otherPluginKey)?.isInvalidated).toBe(false);
    });
});
