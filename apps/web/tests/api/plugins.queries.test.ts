import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';

import { completePluginOAuth, writePluginDetail } from '../../src/api/plugins.queries';
import { queryKeys } from '../../src/api/query.keys';
import { pluginDetail, pluginSummary } from '../utils/plugin.fixture';
import { createTestQueryClient } from '../utils/render';

const completePluginOAuthAuthorization = vi.fn();

vi.mock('../../src/api/client', () => ({
    sdk: { plugins: { completePluginOAuthAuthorization: (...args: unknown[]) => completePluginOAuthAuthorization(...args) } },
}));

afterEach(() => {
    completePluginOAuthAuthorization.mockReset();
});

describe('writePluginDetail', () => {
    it('files the response into the detail read and the matching list entry', () => {
        const queryClient = createTestQueryClient();
        queryClient.setQueryData(queryKeys.plugins.list(), [pluginSummary(), pluginSummary({ id: 'other', name: 'Other' })]);

        writePluginDetail(queryClient, pluginDetail({ enabled: false, status: 'disabled', config: { clientId: 'abc' } }));

        expect(queryClient.getQueryData(queryKeys.plugins.detail('deadair.spotify'))).toMatchObject({ status: 'disabled', config: { clientId: 'abc' } });

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
        completePluginOAuthAuthorization.mockRejectedValue(new SdkError(503, 'Service Unavailable', { statusCode: 503, message: 'plugin host restarting' }, new Headers()));

        const outcome = await completePluginOAuth(createTestQueryClient(), 'deadair.spotify', { state: 'st-1' });

        expect(outcome).toEqual({ failure: 'plugin host restarting' });
    });
});
