import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { PluginDetail, PluginLogLevel, PluginLogQuery, PluginOAuthCallbackQuery, PluginOAuthResult, PluginSummary } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';
import { apiErrorMessage } from './sdk.error';

/**
 * How long a plugin read stays fresh.
 *
 * Statuses move when the operator moves them — and those calls hand back the record, which is
 * written straight into the cache below, with the ones that also reinitialize the plugin
 * refetching for the status their body could not carry (see `writePluginDetailPendingReinit`) —
 * or when the reload listener reacts to a change in `plugin_configs`. Only the last is invisible
 * from here, and it is rare enough that polling for it would spend far more requests than it
 * earns; navigating back to the list after the stale time re-reads it.
 */
const PLUGIN_STALE_TIME = 30_000;

export const pluginsListOptions = queryOptions({
    queryKey: queryKeys.plugins.list(),
    queryFn: () => sdk.plugins.listPlugins(),
    staleTime: PLUGIN_STALE_TIME,
});

export function pluginDetailOptions(id: string) {
    return queryOptions({
        queryKey: queryKeys.plugins.detail(id),
        queryFn: () => sdk.plugins.getPlugin(id),
        staleTime: PLUGIN_STALE_TIME,
    });
}

/**
 * How long a fetched log tail stays fresh.
 *
 * Unlike a plugin record, which only moves when an operator moves it, a plugin's log store fills
 * continuously while it runs. A stale time anywhere near `PLUGIN_STALE_TIME` would show a tail
 * that is seconds to tens of seconds behind the plugin's actual output, so this is kept short
 * instead of reusing that constant.
 */
const PLUGIN_LOGS_STALE_TIME = 3_000;

export function pluginLogsOptions(id: string, query?: PluginLogQuery) {
    return queryOptions({
        queryKey: queryKeys.plugins.logs(id, query),
        queryFn: () => sdk.plugins.getPluginLogs(id, query),
        staleTime: PLUGIN_LOGS_STALE_TIME,
    });
}

/** The list's view of a detail record: everything but the stored configuration and the last error. */
function toSummary(detail: PluginDetail): PluginSummary {
    const { config: _config, lastError: _lastError, ...summary } = detail;
    return summary;
}

/**
 * Files a `PluginDetail` the API just returned into both places it is read from.
 *
 * A mutating call answers with the plugin's own record, so that response is the truth and an
 * invalidate would only buy a second request for an answer already in hand. The list is patched
 * rather than dropped so a card does not blank out mid-toggle.
 *
 * The exception is a call that also reinitializes the plugin, whose body predates the reinit:
 * those go through `writePluginDetailPendingReinit` instead.
 */
export function writePluginDetail(queryClient: QueryClient, detail: PluginDetail): void {
    queryClient.setQueryData(queryKeys.plugins.detail(detail.id), detail);
    queryClient.setQueryData(queryKeys.plugins.list(), (current: PluginSummary[] | undefined) =>
        current?.map(plugin => (plugin.id === detail.id ? toSummary(detail) : plugin)),
    );
}

/**
 * The same, for the calls whose answer is authoritative about everything EXCEPT the plugin's
 * status.
 *
 * A call that changes a plugin's stored settings reinitializes it, and the API defers that
 * reinit until its own transaction has committed — it has to, or the reinit reads the row as
 * it stood before the write. The response body is built before that happens, so its `status`
 * is the one the plugin had on the way in: `disabled` on the call that just enabled it.
 *
 * So the body is still filed, because it is the truth about the configuration and filing it is
 * what keeps a card from blanking mid-toggle, and then the record is refetched for the status.
 * Not awaited: the mutation is done, and the refetch is for whatever renders next.
 */
function writePluginDetailPendingReinit(queryClient: QueryClient, detail: PluginDetail): void {
    writePluginDetail(queryClient, detail);
    void queryClient.invalidateQueries({ queryKey: queryKeys.plugins.detail(detail.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.plugins.list() });
}

/**
 * Turns the switch on a plugin card. One mutation rather than two so the card has a single pending
 * state to disable itself on, whichever way it is being moved.
 */
export function useSetPluginEnabled() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => (enabled ? sdk.plugins.enablePlugin(id) : sdk.plugins.disablePlugin(id)),
        onSuccess: detail => {
            writePluginDetailPendingReinit(queryClient, detail);
        },
    });
}

/**
 * Saves a settings form. The submitted record is partial by design: a key left out keeps whatever
 * the server has stored, which is what lets an operator save without retyping their secrets.
 */
export function useUpdatePluginConfig(id: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (config: Record<string, unknown>) => sdk.plugins.updatePluginConfiguration(id, { config }),
        onSuccess: detail => {
            writePluginDetailPendingReinit(queryClient, detail);
        },
    });
}

/**
 * Sets the minimum severity the plugin's log store retains going forward. Writes the returned
 * detail through `writePluginDetail` like the other plugin mutations, and refetches the logs
 * query, since the level just changed means the next tail reads differently than the last one
 * cached.
 */
export function useSetPluginLogLevel(id: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (level: PluginLogLevel) => sdk.plugins.setPluginLogLevel(id, { level }),
        onSuccess: detail => {
            writePluginDetail(queryClient, detail);
            void queryClient.invalidateQueries({ queryKey: queryKeys.plugins.logs(id) });
        },
    });
}

/**
 * Runs the plugin's own `testConnection()`. A failed connection comes back as `{ ok: false }` with
 * a reason rather than a rejection, so `mutation.error` here means the request itself failed.
 */
export function useTestPlugin(id: string) {
    return useMutation({
        mutationFn: () => sdk.plugins.testPluginConnection(id),
    });
}

/**
 * What the plugin currently offers for its own config fields.
 *
 * A query rather than a mutation despite being a POST: it reads, and the settings form wants it on
 * open. It is a POST because answering means the plugin reaching its upstream with the operator's
 * credentials, which is not a thing to put behind a cacheable GET.
 *
 * Never retried and never refetched on focus. It costs a round trip to somebody's model server, an
 * empty answer is a perfectly usable form, and the operator has an explicit refresh for the case
 * where they have just fixed the address.
 */
export function usePluginConfigSuggestions(id: string) {
    return useQuery({
        queryKey: queryKeys.plugins.configSuggestions(id),
        queryFn: () => sdk.plugins.suggestPluginConfigOptions(id),
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: Infinity,
    });
}

/** Rescans the mounted plugin directory. Needs `platform.manage`, so a non-admin gets a 403. */
export function useRescanPlugins() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => sdk.plugins.rescanPlugins(),
        onSuccess: plugins => {
            queryClient.setQueryData(queryKeys.plugins.list(), plugins);
        },
    });
}

/**
 * Asks where to send the operator for the provider's consent screen.
 *
 * The API reports the URL instead of redirecting to it, because the route sits behind the Bearer
 * floor and a browser navigating there top-level would send no token. So the navigation is ours to
 * perform once this resolves.
 */
export function useStartPluginOAuth(id: string) {
    return useMutation({
        mutationFn: () => sdk.plugins.startPluginOAuthAuthorization(id),
    });
}

/**
 * Revokes a plugin's stored OAuth connection. Mirrors `useSetPluginEnabled`'s shape, including the
 * refetch: clearing the vault reinitializes the plugin, and that happens after the response body
 * was built.
 */
export function useDisconnectPluginOAuth(id: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => sdk.plugins.disconnectPluginOAuth(id),
        onSuccess: detail => {
            writePluginDetailPendingReinit(queryClient, detail);
        },
    });
}

/** What came back from the callback leg: the API's verdict, or why it never gave one. */
export interface PluginOAuthOutcome {
    result?: PluginOAuthResult;
    failure?: string;
}

/**
 * Hands the provider's callback parameters to the API, which checks the `state` it minted, lets the
 * plugin exchange the code, and reports the outcome.
 *
 * Called from the callback route's loader rather than an effect. The `state` is single use, so this
 * must run exactly once per arrival, and a loader runs once per navigation outside React's
 * lifecycle — where an effect is invoked twice under StrictMode and a `useMutation` fired from one
 * loses track of its own result across the remount.
 *
 * A rejection is folded into the return rather than thrown: the operator has just come back from a
 * provider and needs a sentence, not the router's error boundary.
 */
export async function completePluginOAuth(queryClient: QueryClient, id: string, query: PluginOAuthCallbackQuery): Promise<PluginOAuthOutcome> {
    try {
        const result = await sdk.plugins.completePluginOAuthAuthorization(id, query);
        // The plugin now holds tokens it did not have, which its status reflects. Not awaited: the
        // page has its answer already, and the refetch is for whatever is read next.
        void queryClient.invalidateQueries({ queryKey: queryKeys.plugins.detail(id) });
        return { result };
    } catch (error) {
        return { failure: apiErrorMessage(error, 'The authorization could not be completed.') };
    }
}
