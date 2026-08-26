import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Segment, SegmentCreate, SegmentList } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How often the library is re-read while something in it is still being made.
 *
 * A segment is planned, then written, then rendered, and the POST answers `planned` every time: the
 * words and the audio arrive on the station's own schedule, seconds to a minute later. So the list
 * polls, but ONLY while a row is actually in one of those states, on the pattern the script history
 * already uses for its first page. A library of finished segments is a table nobody is waiting on,
 * and polling it would be a request every five seconds for a page that cannot change.
 */
const SEGMENTS_POLL_MS = 5_000;

/** The states a segment passes through on its way to being playable. */
const IN_FLIGHT = new Set(['planned', 'writing', 'written', 'rendering']);

export const segmentsOptions = queryOptions({
    queryKey: queryKeys.segments.list(),
    queryFn: () => sdk.render.listSegments(),
    refetchInterval: query => (query.state.data?.segments.some(segment => IN_FLIGHT.has(segment.state)) === true ? SEGMENTS_POLL_MS : false),
});

/** Everything the station can play that is not a record. */
export function useSegments() {
    return useQuery(segmentsOptions);
}

/**
 * Plans a segment and asks the station to speak it.
 *
 * The answer is the row as it stands, which is `planned`: the render is a job. The list is
 * invalidated rather than patched, because a new row has to appear in it and the poll above only
 * starts once something in the list is in flight.
 */
export function useCreateSegment() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (body: SegmentCreate) => sdk.render.createSegment(body),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.segments.list() }),
    });
}

/**
 * Takes a recording in from the browser.
 *
 * Invalidates on SETTLE rather than on success, unlike `useCreateSegment` beside it: an upload can
 * land a file on disk and still answer with something the caller reads as a failure, and an operator
 * told their recording was refused while looking at a list that does not have it has been told the
 * wrong thing twice.
 */
export function useUploadSegment() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (body: FormData) => sdk.render.uploadSegment(body),
        onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.segments.list() }),
    });
}

/**
 * Removes a recording the station was given, and the inbox file behind it.
 *
 * Answers the whole library rather than the row that went, so nothing refetches: the page draws every
 * kind it holds, and a delete can empty a heading as well as a row.
 */
export function useDeleteSegment() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => sdk.render.deleteSegment(id),
        onSuccess: (list: SegmentList) => queryClient.setQueryData(queryKeys.segments.list(), list),
    });
}

/** Reads the inbox for audio somebody dropped in, and imports what is not already known. */
export function useScanSegments() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: () => sdk.render.scanTheSegmentInbox(),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.segments.list() }),
    });
}

/**
 * Fetches one segment's audio and hands back an object URL to play it with.
 *
 * Unlike a voice sample this route is anonymous, so an `<audio src>` pointing straight at it would
 * work. It still goes through the SDK: the console holds one idea of where the API is, and a second
 * URL composed by hand here is one more thing to keep in step with it.
 *
 * The caller owns the URL and must revoke it, exactly as `fetchVoiceSample` documents.
 */
export async function fetchSegmentAudio(id: string): Promise<string> {
    const result = await sdk.render.getSegmentAudio(id);

    // A 304 is documented because the conditional-GET middleware can produce one. This caller sends
    // no validator, so there is nothing to match and nothing cached to fall back on.
    if (result.status !== 200) throw new Error(`that segment came back with no audio (${result.status})`);

    return URL.createObjectURL(result.data);
}

export type { Segment, SegmentList };
