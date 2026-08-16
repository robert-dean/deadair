import { queryOptions, useQuery } from '@tanstack/react-query';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How long a disk reading stands.
 *
 * The API walks four directories to answer this and caches its own reading for a minute, so asking
 * more often than that buys nothing but requests. Matched to that rather than guessed: a shorter
 * stale time would refetch and be handed the same cached numbers back, which reads as a page that
 * updates and is not.
 */
const STORAGE_STALE_TIME = 60_000;

export const storageOptions = queryOptions({
    queryKey: queryKeys.storage.all(),
    queryFn: () => sdk.storage.readStorage(),
    staleTime: STORAGE_STALE_TIME,
});

/** How much disk the station is using, per store. */
export function useStorage() {
    return useQuery(storageOptions);
}
