import { queryOptions, useQuery } from '@tanstack/react-query';
import type { PronunciationList, PronunciationStateWrite, PronunciationWrite } from '@deadair/sdk';

import { sdk } from './client';
import { useListWrite } from './mutation.kit';
import { queryKeys } from './query.keys';

/**
 * How long the station's lexicon stays fresh.
 *
 * The topics' reasoning: it moves when an operator moves it, every write answers with the whole
 * list and is written straight into the cache. The one writer that is not this page is the mining
 * pass, which runs in the background and lands proposals — thirty seconds is how long it takes for
 * one to show up without a refresh.
 */
const PRONUNCIATIONS_STALE_TIME = 30_000;

export const pronunciationsOptions = queryOptions({
    queryKey: queryKeys.pronunciations.list(),
    queryFn: () => sdk.render.listPronunciations({}),
    staleTime: PRONUNCIATIONS_STALE_TIME,
});

/** Everything the station says differently, in every state. */
export function usePronunciations() {
    return useQuery(pronunciationsOptions);
}

/** Every write, sharing one success path: the answer is the whole list, so nothing refetches. */
function usePronunciationWrite<TArgs>(mutationFn: (args: TArgs) => Promise<PronunciationList>) {
    return useListWrite(queryKeys.pronunciations.list(), mutationFn);
}

export const useCreatePronunciation = () => usePronunciationWrite((body: PronunciationWrite) => sdk.render.createPronunciation(body));

export const useUpdatePronunciation = () =>
    usePronunciationWrite(({ id, body }: { id: string; body: PronunciationWrite }) => sdk.render.updatePronunciation(id, body));

export const useSetPronunciationState = () =>
    usePronunciationWrite(({ id, body }: { id: string; body: PronunciationStateWrite }) => sdk.render.setPronunciationState(id, body));

export const useDeletePronunciation = () => usePronunciationWrite((id: string) => sdk.render.deletePronunciation(id));

/**
 * Speak one entry and hand back an object URL to play it with: the written word, said the way this
 * entry says it, in one voice.
 *
 * The entry goes by its words rather than its id, so a respelling can be heard while it is still being
 * typed, and a proposal before it is accepted. The blob rationale is `fetchSpeechPreview`'s: an
 * `<audio src>` sends no Authorization header, so the bytes come through the SDK.
 *
 * The caller owns the URL and must `revokeObjectURL` it. `useVoicePreview` does.
 */
export async function fetchPronunciationSample(written: string, spoken: string, voice?: string): Promise<string> {
    const result = await sdk.render.samplePronunciation({ written, spoken, ...(voice === undefined ? {} : { voice }) });
    return URL.createObjectURL(result.data);
}
