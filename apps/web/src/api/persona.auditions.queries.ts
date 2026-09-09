import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PersonaAuditionRequest } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How often a run is re-read while it is still being written.
 *
 * Slower than the segments list and for the opposite reason to the productions page: a transition is
 * one model generation at the `preview` tier, so it lands when the station is not busy and not
 * before. Polling harder would be a request every few seconds for a row that changes when a break
 * finishes, which is minutes on a station doing anything else.
 */
const AUDITION_POLL_MS = 8_000;

/** A run in one of these is still being written, and is the only reason to keep asking. */
const IN_FLIGHT = new Set(['queued', 'running']);

/**
 * One character's runs, newest first, polled only while one is unsettled.
 *
 * The polling is conditional on the DATA rather than on the page being open, which is
 * `segments.queries.ts`' shape: a list of finished runs is a page nobody is waiting on, and an
 * operator who left the tab open on last week's auditions should not be making requests all
 * afternoon.
 */
export function personaAuditionsOptions(personaId: string) {
    return queryOptions({
        queryKey: queryKeys.personas.auditions(personaId),
        queryFn: () => sdk.personas.listPersonaAuditions(personaId),
        refetchInterval: query => (query.state.data?.auditions.some(run => IN_FLIGHT.has(run.state)) === true ? AUDITION_POLL_MS : false),
        enabled: personaId.length > 0,
    });
}

/** One run with every break it has written so far. Polled while it is still writing them. */
export function personaAuditionOptions(personaId: string, auditionId: string) {
    return queryOptions({
        queryKey: queryKeys.personas.audition(personaId, auditionId),
        queryFn: () => sdk.personas.getPersonaAudition(personaId, auditionId),
        refetchInterval: query => (IN_FLIGHT.has(query.state.data?.state ?? '') ? AUDITION_POLL_MS : false),
    });
}

export function usePersonaAuditions(personaId: string) {
    return useQuery(personaAuditionsOptions(personaId));
}

export function usePersonaAudition(personaId: string, auditionId: string) {
    return useQuery(personaAuditionOptions(personaId, auditionId));
}

/**
 * Both writes, sharing one success path.
 *
 * Each answers with the ONE run it touched, so neither answer can be written into the cache as the
 * list; the list is invalidated and refetched instead. That is `productions.queries.ts`' arrangement
 * and it is copied rather than imported, because its helper is private to that file and the two
 * lists have nothing else in common.
 */
function useRunRefresh<TArgs, TResult>(personaId: string, mutationFn: (args: TArgs) => Promise<TResult>) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn,
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.personas.auditions(personaId) });
        },
    });
}

/**
 * Put a character through a playlist.
 *
 * A mutation despite the answer being a row rather than a change to one, because it QUEUES a run of
 * generations: it must not be prefetched, retried on a window focus, or served from a cache. What
 * comes back is a run with no breaks in it yet, which the page says out loud — an operator who
 * expected to read a break would take an empty card for a failure.
 */
export const useStartPersonaAudition = (personaId: string) =>
    useRunRefresh(personaId, (body: PersonaAuditionRequest) => sdk.personas.startPersonaAudition(personaId, body));

/** Stop one where it stands. The breaks it already wrote are kept. */
export const useCancelPersonaAudition = (personaId: string) =>
    useRunRefresh(personaId, (auditionId: string) => sdk.personas.cancelPersonaAudition(personaId, auditionId));
