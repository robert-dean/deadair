import { useQuery } from '@tanstack/react-query';
import type { FestivalInput, FestivalList } from '@deadair/sdk';

import { sdk } from './client';
import { useListWrite } from './mutation.kit';
import { queryKeys } from './query.keys';

/** Every festival on the station, soonest first, each saying whether it is still to come, on or over. */
export function useFestivals() {
    return useQuery({
        queryKey: queryKeys.schedule.festivals(),
        queryFn: () => sdk.schedule.listFestivals(),
    });
}

/** Every festival write answers the whole list, which is written straight into the cache. */
function useFestivalWrite<TArgs>(mutationFn: (args: TArgs) => Promise<FestivalList>) {
    return useListWrite(queryKeys.schedule.festivals(), mutationFn);
}

export function useAddFestival() {
    return useFestivalWrite((festival: FestivalInput) => sdk.schedule.addAFestival(festival));
}

export function useChangeFestival() {
    return useFestivalWrite(({ id, festival }: { id: string; festival: FestivalInput }) => sdk.schedule.changeAFestival(id, festival));
}

export function useRemoveFestival() {
    return useFestivalWrite((id: string) => sdk.schedule.removeAFestival(id));
}
