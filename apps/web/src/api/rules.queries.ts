import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BlockRuleInput, BlockRuleList, GenreSteerInput, GenreSteerReading } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * Half a minute, on the clock's reasoning, and for one more: whether a rule holds NOW and whether a
 * lean has run out both move with the clock rather than with anything the console did.
 */
const RULES_STALE_TIME = 30_000;

/** Every never-play rule, each saying whether it holds right now. */
export function useNeverPlayRules() {
    return useQuery({
        queryKey: queryKeys.director.rules(),
        queryFn: () => sdk.director.listNeverPlayRules(),
        staleTime: RULES_STALE_TIME,
        refetchInterval: RULES_STALE_TIME,
    });
}

/** Every rule write answers the whole list, which is written straight into the cache. */
function useRuleWrite<TArgs>(mutationFn: (args: TArgs) => Promise<BlockRuleList>) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn,
        onSuccess: (rules: BlockRuleList) => queryClient.setQueryData(queryKeys.director.rules(), rules),
    });
}

export function useAddNeverPlayRule() {
    return useRuleWrite((rule: BlockRuleInput) => sdk.director.addANeverPlayRule(rule));
}

export function useRemoveNeverPlayRule() {
    return useRuleWrite((id: string) => sdk.director.removeANeverPlayRule(id));
}

/** The lean in force, if any. */
export function useGenreSteer() {
    return useQuery({
        queryKey: queryKeys.director.steer(),
        queryFn: () => sdk.director.readTheGenreSteer(),
        staleTime: RULES_STALE_TIME,
        refetchInterval: RULES_STALE_TIME,
    });
}

function useSteerWrite<TArgs>(mutationFn: (args: TArgs) => Promise<GenreSteerReading>) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn,
        onSuccess: (reading: GenreSteerReading) => queryClient.setQueryData(queryKeys.director.steer(), reading),
    });
}

export function useSteerTowardGenres() {
    return useSteerWrite((input: GenreSteerInput) => sdk.director.steerTowardGenres(input));
}

export function useStopSteering() {
    return useSteerWrite((_: void) => sdk.director.stopSteering());
}
