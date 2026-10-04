import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PersonaPortraitList } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/** Every persona that has a picture, and where it is served. */
export function usePersonaPortraits() {
    return useQuery({
        queryKey: queryKeys.personaPortraits.list(),
        queryFn: () => sdk.art.listPersonaPortraits(),
    });
}

/** Put a picture on a persona. */
export function useReplacePersonaPortrait() {
    return usePortraitArrival(({ personaId, body }: { personaId: string; body: FormData }) => sdk.art.replacePersonaPortrait(personaId, body));
}

/** Take a persona's picture away. */
export function useRemovePersonaPortrait() {
    return usePortraitArrival((personaId: string) => sdk.art.removePersonaPortrait(personaId));
}

/**
 * Both writes answer with the whole listing and are settled the same way, on `break.art.queries.ts`'
 * terms: invalidated rather than written in, and the image itself left to the `no-cache` the API
 * serves a replaceable picture with.
 */
function usePortraitArrival<TArgs>(mutationFn: (args: TArgs) => Promise<PersonaPortraitList>) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn,
        onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.personaPortraits.list() }),
    });
}
