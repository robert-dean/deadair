import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ScheduleSlotInput, ScheduleSlotList } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How long the schedule stays fresh.
 *
 * The same reasoning as the persona list: slots move when an operator moves them, and every write
 * here answers with the whole schedule, which is written straight into the cache below. The only
 * invisible writer is somebody editing the table by hand.
 */
const SCHEDULE_STALE_TIME = 30_000;

export const scheduleOptions = queryOptions({
    queryKey: queryKeys.schedule.list(),
    queryFn: () => sdk.schedule.listSchedule(),
    staleTime: SCHEDULE_STALE_TIME,
});

/** Every slot in this station's day, earliest first. */
export function useSchedule() {
    return useQuery(scheduleOptions);
}

/**
 * Every write, sharing one success path.
 *
 * The API answers each of them with the whole schedule rather than the row it touched, because a
 * slot has no end of its own: it runs until the next one begins, so adding, moving or deleting one
 * changes how its neighbours read. The answer is written into the cache and nothing refetches.
 */
function useListWrite<TArgs>(mutationFn: (args: TArgs) => Promise<ScheduleSlotList>) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn,
        onSuccess: (schedule: ScheduleSlotList) => {
            queryClient.setQueryData(queryKeys.schedule.list(), schedule);
        },
    });
}

export const useCreateSlot = () => useListWrite((body: ScheduleSlotInput) => sdk.schedule.createScheduleSlot(body));

export const useUpdateSlot = () => useListWrite(({ id, body }: { id: string; body: ScheduleSlotInput }) => sdk.schedule.updateScheduleSlot(id, body));

export const useDeleteSlot = () => useListWrite((id: string) => sdk.schedule.deleteScheduleSlot(id));
