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
 * How often to ask which slot is on.
 *
 * Polled rather than cached, unlike the grid above, because this answer moves on its own: the clock
 * crosses a boundary and the station changes over without anything the console did. Half a minute is
 * inside the minute the tick itself runs on, so the page is never more than one tick behind the
 * station.
 */
const CURRENT_POLL_MS = 30_000;

export const currentSlotOptions = queryOptions({
    queryKey: queryKeys.schedule.current(),
    queryFn: () => sdk.schedule.readCurrentSlot(),
    refetchInterval: CURRENT_POLL_MS,
    staleTime: CURRENT_POLL_MS,
});

/**
 * Which slot the clock says should be on, and which one the station is airing.
 *
 * Two answers rather than one because they legitimately differ: an operator's own choice holds until
 * the next slot BEGINS, so between a takeover and that boundary the schedule wants something the
 * station is not doing. A single "on now" would be confidently wrong for exactly as long as somebody
 * was doing something deliberate.
 */
export function useCurrentSlot() {
    return useQuery(currentSlotOptions);
}

/**
 * The station's day as blocks, for the window being drawn.
 *
 * `from` is a date on the STATION's calendar and the browser cannot work one out, so `undefined`
 * means "the station's today" and the answer echoes the range it drew. Every step forward and back
 * after that is adding days to that string, which is why nothing here needs to know the zone.
 */
export function useTimetable(from: string | undefined, days: number) {
    return useQuery({
        queryKey: queryKeys.schedule.timetable(from, days),
        queryFn: () => sdk.schedule.readTimetable({ ...(from === undefined ? {} : { from }), days }),
        staleTime: SCHEDULE_STALE_TIME,
    });
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
            // The blocks are DERIVED from the slots, so a write invalidates every window rather than
            // being written into the cache: the answer depends on a range this callback knows
            // nothing about, and one slot moving changes how its neighbours read in all of them.
            void queryClient.invalidateQueries({ queryKey: ['schedule', 'timetable'] });
        },
    });
}

export const useCreateSlot = () => useListWrite((body: ScheduleSlotInput) => sdk.schedule.createScheduleSlot(body));

export const useUpdateSlot = () => useListWrite(({ id, body }: { id: string; body: ScheduleSlotInput }) => sdk.schedule.updateScheduleSlot(id, body));

export const useDeleteSlot = () => useListWrite((id: string) => sdk.schedule.deleteScheduleSlot(id));
