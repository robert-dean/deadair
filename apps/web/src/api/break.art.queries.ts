import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BreakArtworkList } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/** The picture each kind of break wears, and where those bytes came from. */
export function useBreakArtwork() {
    return useQuery({
        queryKey: queryKeys.breakArtwork.list(),
        queryFn: () => sdk.art.listBreakArtwork(),
    });
}

/** Put an operator's own picture behind a kind. */
export function useReplaceBreakArtwork() {
    return useBreakArtworkArrival(({ kind, body }: { kind: string; body: FormData }) => sdk.art.replaceBreakArtwork(kind, body));
}

/** Put back the picture this repository ships. */
export function useRevertBreakArtwork() {
    return useBreakArtworkArrival((kind: string) => sdk.art.revertBreakArtwork(kind));
}

/**
 * Both writes answer with the whole listing, so both are settled the same way.
 *
 * Invalidated rather than written straight in, on `pads.queries.ts`' argument: the answer is the
 * whole set and a write can change a row this one did not touch — reverting weather has no effect
 * on news, but nothing in the shape says so, and a cache written from a partial view is the kind of
 * thing that only shows up on the second click.
 *
 * The images themselves are outside React Query entirely: they are `<img>` requests against a URL
 * whose id does not change when the picture behind it does. Nothing here has to bust that, because
 * the API sends `no-cache` on exactly these rows — see `ArtService` — so the browser revalidates
 * against the checksum ETag and is handed the new bytes the moment they change.
 */
function useBreakArtworkArrival<TArgs>(mutationFn: (args: TArgs) => Promise<BreakArtworkList>) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn,
        onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.breakArtwork.list() }),
    });
}
