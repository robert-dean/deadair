import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ScheduleSlotInput, ScheduleSlotList } from '@deadair/sdk';

import { sdk } from './client';
import { followStationExtend } from './director.queries';
import { useListWrite } from './mutation.kit';
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
function useScheduleWrite<TArgs>(mutationFn: (args: TArgs) => Promise<ScheduleSlotList>) {
    return useListWrite(queryKeys.schedule.list(), mutationFn, [
        // The blocks are DERIVED from the slots, so a write invalidates every window rather than
        // being written into the cache: the answer depends on a range this callback knows
        // nothing about, and one slot moving changes how its neighbours read in all of them.
        ['schedule', 'timetable'],
        // And what is on NOW is derived from them too. Without this the strip above the grid
        // keeps its last answer for up to a poll — so an operator who has just written the block
        // they are standing in watches the page say nothing is scheduled, which is the one thing
        // it must never say while being wrong about it.
        queryKeys.schedule.current(),
        // And where a resuming slot will pick its playlist up, which an edit to its source forgets.
        ['schedule', 'playlist-position'],
    ]);
}

export const useCreateSlot = () => useScheduleWrite((body: ScheduleSlotInput) => sdk.schedule.createScheduleSlot(body));

export const useUpdateSlot = () =>
    useScheduleWrite(({ id, body }: { id: string; body: ScheduleSlotInput }) => sdk.schedule.updateScheduleSlot(id, body));

export const useDeleteSlot = () => useScheduleWrite((id: string) => sdk.schedule.deleteScheduleSlot(id));

/**
 * The record a slot that resumes its playlist will open on next time, or an empty answer when it
 * would start from the top.
 *
 * Asked only while the editor is open on a slot that resumes, because the station reads the whole
 * playlist to answer it: the same read the opening makes, so the answer is the record the opening
 * would choose. Not polled, and stale at once: the place moves every time a record from the playlist
 * airs, so the editor asks afresh each time it opens rather than trusting a minute-old answer.
 */
export function useSlotPlaylistPosition(id: string | undefined, enabled: boolean) {
    return useQuery({
        queryKey: queryKeys.schedule.playlistPosition(id ?? ''),
        queryFn: () => sdk.schedule.readSlotPlaylistPosition(id ?? ''),
        enabled: enabled && id !== undefined,
        staleTime: 0,
    });
}

/**
 * Apply a slot, as it is saved now, to the show on air.
 *
 * The answer says what changed now, what waits for the slot's next occurrence, and whether the
 * records still to come are being chosen again. A replan is queued rather than done by the time this
 * answers, so the running order is followed up the way an extend or a replan is: what actually shows
 * the new hour is the order's own poll, which the replan may outlast.
 */
export function useApplySlot() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => sdk.schedule.applyScheduleSlotToAir(id),
        onSuccess: () => {
            // The name, host and rules are on the order at once; the records follow the replan.
            void queryClient.invalidateQueries({ queryKey: queryKeys.director.order() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.director.air() });
            followStationExtend(queryClient);
        },
    });
}

/** Start a slot's playlist from the top the next time it opens. */
export function useRestartSlotPlaylist() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => sdk.schedule.restartSlotPlaylist(id),
        onSuccess: (_answer, id) => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.schedule.playlistPosition(id) });
        },
    });
}
