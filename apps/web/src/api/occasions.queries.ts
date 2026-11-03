import { useQuery } from '@tanstack/react-query';
import type { OccasionInput, OccasionList, OccasionOrder } from '@deadair/sdk';

import { sdk } from './client';
import { useListWrite } from './mutation.kit';
import { queryKeys } from './query.keys';

/** Every occasion, in the order a date is matched against them, each saying when it next falls. */
export function useOccasions() {
    return useQuery({
        queryKey: queryKeys.schedule.occasions(),
        queryFn: () => sdk.schedule.listOccasions(),
    });
}

/** Every occasion write answers the whole list, which is written straight into the cache. */
function useOccasionWrite<TArgs>(mutationFn: (args: TArgs) => Promise<OccasionList>) {
    return useListWrite(queryKeys.schedule.occasions(), mutationFn);
}

export function useAddOccasion() {
    return useOccasionWrite((occasion: OccasionInput) => sdk.schedule.addAnOccasion(occasion));
}

export function useChangeOccasion() {
    return useOccasionWrite(({ id, occasion }: { id: string; occasion: OccasionInput }) => sdk.schedule.changeAnOccasion(id, occasion));
}

export function useRemoveOccasion() {
    return useOccasionWrite((id: string) => sdk.schedule.removeAnOccasion(id));
}

export function useReorderOccasions() {
    return useOccasionWrite((order: OccasionOrder) => sdk.schedule.reorderOccasions(order));
}
