import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PersonaInput, PersonaList, PersonaRehearsal } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How long the persona list stays fresh.
 *
 * The same reasoning as `SETTINGS_STALE_TIME`: these move when an operator moves them, and every
 * write here answers with the whole list, which is written straight into the cache below. The only
 * invisible writer is somebody editing the table by hand.
 */
const PERSONAS_STALE_TIME = 30_000;

export const personasOptions = queryOptions({
    queryKey: queryKeys.personas.list(),
    queryFn: () => sdk.personas.listPersonas(),
    staleTime: PERSONAS_STALE_TIME,
});

/** Every persona this station has, and which one is on air. */
export function usePersonas() {
    return useQuery(personasOptions);
}

/**
 * Every write, sharing one success path.
 *
 * The API answers each of them with the whole list rather than the row it touched, because each of
 * them can change more than that row: putting one on air takes another off, and deleting the active
 * one leaves the station with none. So the answer is written into the cache and nothing refetches.
 */
function useListWrite<TArgs>(mutationFn: (args: TArgs) => Promise<PersonaList>) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn,
        onSuccess: (personas: PersonaList) => {
            queryClient.setQueryData(queryKeys.personas.list(), personas);
        },
    });
}

export const useCreatePersona = () => useListWrite((body: PersonaInput) => sdk.personas.createPersona(body));

export const useUpdatePersona = () => useListWrite(({ id, body }: { id: string; body: PersonaInput }) => sdk.personas.updatePersona(id, body));

export const useDeletePersona = () => useListWrite((id: string) => sdk.personas.deletePersona(id));

export const usePutPersonaOnAir = () => useListWrite((id: string) => sdk.personas.putPersonaOnAir(id));

/**
 * Put back whichever of the station's own personas are missing.
 *
 * Touches nothing already here and puts nothing on air, so it is safe to press twice — which is
 * what makes it a plain button rather than something behind a confirmation.
 */
export const useRestorePersonas = () => useListWrite(() => sdk.personas.restoreStationPersonas());

/**
 * Ask a persona for a break it will never air.
 *
 * A mutation rather than a query despite reading nothing, because it spends a generation: it must
 * not be prefetched, retried on a window focus, or served from a cache. Every click is meant to be
 * a fresh reading, since the point of pressing it twice is to hear what an edit changed.
 *
 * Nothing is written into the persona cache — a rehearsal changes no row.
 */
export const useRehearsePersona = () =>
    useMutation<PersonaRehearsal, Error, string>({
        mutationFn: (id: string) => sdk.personas.rehearsePersona(id),
    });
