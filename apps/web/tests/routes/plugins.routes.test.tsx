// The two plugin route modules rather than their pages: what is under test is each loader's
// contract with the router, namely that a failed prefetch does not abandon the navigation. Both
// pages already render their own alert off the cached error; these cases are what make that alert
// reachable on a first navigation. The sibling `/plugins/$id/oauth/callback` loader is absent on
// purpose — `completePluginOAuth` resolves to a `{ result } | { failure }` outcome and never
// rejects, so it has nothing to swallow.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';

import { queryKeys } from '../../src/api/query.keys';
import { createTestQueryClient } from '../utils/render';

const listPlugins = vi.fn();
const getPlugin = vi.fn();

vi.mock('../../src/api/client', () => ({
    sdk: {
        plugins: {
            listPlugins: () => listPlugins(),
            getPlugin: (id: string) => getPlugin(id),
        },
    },
}));

// Curried like the real thing — `createFileRoute(path)(options)` — but handing the options back
// so the loaders can be called directly, without standing up the generated route tree.
vi.mock('@tanstack/react-router', () => ({
    createFileRoute: () => (options: unknown) => options,
}));

const { Route: ListRoute } = await import('../../src/routes/plugins/index');
const { Route: DetailRoute } = await import('../../src/routes/plugins/$id/index');

const PLUGIN_ID = 'deadair.spotify';

type LoaderRoute = { loader: (args: unknown) => Promise<unknown> };

const unavailable = () => new SdkError(503, 'Service Unavailable', { statusCode: 503, message: 'the catalogue is down' }, new Headers());

afterEach(() => {
    listPlugins.mockReset();
    getPlugin.mockReset();
});

describe('/plugins loader', () => {
    const run = (queryClient: ReturnType<typeof createTestQueryClient>) => (ListRoute as unknown as LoaderRoute).loader({ context: { queryClient } });

    it('warms the cache from the same query the page reads', async () => {
        const plugins = [{ id: PLUGIN_ID }];
        listPlugins.mockResolvedValue(plugins);
        const queryClient = createTestQueryClient();

        await run(queryClient);

        expect(queryClient.getQueryData(queryKeys.plugins.list())).toEqual(plugins);
    });

    it('resolves rather than rejecting when the catalogue is unavailable, so navigation still lands', async () => {
        listPlugins.mockRejectedValue(unavailable());

        await expect(run(createTestQueryClient())).resolves.toBeUndefined();
    });

    it('leaves the failure in the query cache, which is what the page renders its alert from', async () => {
        listPlugins.mockRejectedValue(unavailable());
        const queryClient = createTestQueryClient();

        await run(queryClient);

        const state = queryClient.getQueryState(queryKeys.plugins.list());
        expect(state?.status).toBe('error');
        expect(state?.error).toBeInstanceOf(SdkError);
    });
});

describe('/plugins/$id loader', () => {
    const run = (queryClient: ReturnType<typeof createTestQueryClient>) =>
        (DetailRoute as unknown as LoaderRoute).loader({ context: { queryClient }, params: { id: PLUGIN_ID } });

    it('warms the cache from the same query the page reads', async () => {
        const detail = { id: PLUGIN_ID, name: 'Spotify' };
        getPlugin.mockResolvedValue(detail);
        const queryClient = createTestQueryClient();

        await run(queryClient);

        expect(getPlugin).toHaveBeenCalledWith(PLUGIN_ID);
        expect(queryClient.getQueryData(queryKeys.plugins.detail(PLUGIN_ID))).toEqual(detail);
    });

    it('resolves rather than rejecting for a deep link to a plugin that is gone', async () => {
        getPlugin.mockRejectedValue(new SdkError(404, 'Not Found', { statusCode: 404, message: 'not installed' }, new Headers()));

        await expect(run(createTestQueryClient())).resolves.toBeUndefined();
    });

    it('leaves the failure in the query cache, which is what the page renders its alert from', async () => {
        getPlugin.mockRejectedValue(new SdkError(404, 'Not Found', { statusCode: 404, message: 'not installed' }, new Headers()));
        const queryClient = createTestQueryClient();

        await run(queryClient);

        const state = queryClient.getQueryState(queryKeys.plugins.detail(PLUGIN_ID));
        expect(state?.status).toBe('error');
        expect(state?.error).toBeInstanceOf(SdkError);
    });
});
