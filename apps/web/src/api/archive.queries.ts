import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How often the list is read again while it is open.
 *
 * A recording in progress grows and then ends, and a new one appears the moment a live show goes on
 * air. Half a minute is quick enough to see either without the page being a poll on the disk.
 */
const RECORDINGS_REFETCH_MS = 30_000;

export const recordingsOptions = queryOptions({
    queryKey: queryKeys.archive.recordings(),
    queryFn: () => sdk.stream.archive.listRecordings(),
    refetchInterval: RECORDINGS_REFETCH_MS,
});

/** The archive: every recording, newest first, and what it is set to keep. */
export function useRecordings() {
    return useQuery(recordingsOptions);
}

/** Deletes a finished recording, for good. `retry: false`: a delete is not something to repeat behind the operator's back. */
export function useDeleteRecording() {
    const queryClient = useQueryClient();
    return useMutation({
        retry: false,
        mutationFn: (id: string) => sdk.stream.archive.deleteRecording(id),
        onSettled: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.archive.recordings() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.storage.all() });
        },
    });
}
