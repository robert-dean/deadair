import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClockBandInput, ClockBandList } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How long the format clock stays fresh.
 *
 * The schedule's reasoning exactly: bands move when an operator moves them, every write answers with
 * the whole clock and is written straight into the cache, and the only invisible writer is somebody
 * editing the table by hand.
 */
const CLOCK_STALE_TIME = 30_000;

export const clockOptions = queryOptions({
    queryKey: queryKeys.director.clock(),
    queryFn: () => sdk.director.listClockBands(),
    staleTime: CLOCK_STALE_TIME,
});

/** Every band on the station's clock, switched-off ones included, in the operator's own order. */
export function useClockBands() {
    return useQuery(clockOptions);
}

/**
 * Every write, sharing one success path.
 *
 * The API answers each of them with the whole clock rather than the row it touched, because order is
 * preference: moving one band changes which of them takes a boundary they both want. Nothing else is
 * derived from this, so unlike the schedule there is nothing further to invalidate.
 */
function useClockWrite<TArgs>(mutationFn: (args: TArgs) => Promise<ClockBandList>) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn,
        onSuccess: (clock: ClockBandList) => queryClient.setQueryData(queryKeys.director.clock(), clock),
    });
}

export const useCreateClockBand = () => useClockWrite((body: ClockBandInput) => sdk.director.createClockBand(body));

export const useUpdateClockBand = () => useClockWrite(({ id, body }: { id: string; body: ClockBandInput }) => sdk.director.updateClockBand(id, body));

export const useDeleteClockBand = () => useClockWrite((id: string) => sdk.director.deleteClockBand(id));
