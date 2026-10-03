import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OutputCastRequest } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How often the casts are re-read while somebody is looking at them.
 *
 * Polled for the transport's reason: a speaker starts, buffers, drops and comes back on its own, and
 * none of it begins in this browser. Slower than the transport, because every read asks each
 * speaker over the network, and a speaker takes seconds to change state anyway.
 */
const CASTS_POLL_MS = 10_000;

/**
 * Every speaker the station can play on. Read only when asked for (`enabled`), because listing them
 * is a question to every output plugin, and the desk does not need the answer until the menu opens.
 */
export function useOutputDevices(enabled: boolean) {
    return useQuery({
        queryKey: queryKeys.outputs.devices(),
        queryFn: () => sdk.outputs.listOutputDevices(),
        enabled,
    });
}

/** The speakers the station is meant to be playing on, and how each is doing. */
export function useOutputCasts(enabled: boolean) {
    return useQuery({
        queryKey: queryKeys.outputs.casts(),
        queryFn: () => sdk.outputs.listCasts(),
        enabled,
        refetchInterval: CASTS_POLL_MS,
    });
}

/** Plays the station on a speaker. Both lists change: the speaker is now casting. */
export function useStartCast() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (request: OutputCastRequest) => sdk.outputs.startCast(request),
        onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.outputs.all() }),
    });
}

/** Stops the station on a speaker. */
export function useStopCast() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ pluginId, deviceId }: { pluginId: string; deviceId: string }) => sdk.outputs.stopCast(pluginId, deviceId),
        onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.outputs.all() }),
    });
}
