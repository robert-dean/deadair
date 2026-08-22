import { queryOptions, useQuery } from '@tanstack/react-query';

import { sdk } from './client';
import { queryKeys } from './query.keys';

export const voicesOptions = queryOptions({
    queryKey: queryKeys.voices.list(),
    queryFn: () => sdk.render.listVoices(),
});

/** The voices the station can be asked to speak in, and which plugin answered. */
export function useVoices(enabled: boolean) {
    return useQuery({ ...voicesOptions, enabled });
}

/**
 * Fetch one voice's sample and hand back an object URL to play it with.
 *
 * Not an `<audio src>` pointing at the route, and that is the whole reason this function exists:
 * the console holds its bearer token in memory, an `<audio>` element sends no Authorization header,
 * and the sample route is deliberately not anonymous the way segment audio is. So the bytes come
 * through the SDK, which does carry the token, and the player is pointed at a blob.
 *
 * The caller owns the URL and must `revokeObjectURL` it: an object URL pins its blob in memory
 * until it is revoked or the document goes away.
 */
export async function fetchVoiceSample(voiceId: string): Promise<string> {
    // The plugin's own default answers to the empty string, which no path segment can carry — so it
    // has a route of its own rather than a blank id in this one. Branching here rather than at the
    // three call sites, because which URL a voice lives at is this file's business and none of
    // theirs: a voice is a voice to a play button.
    const result = voiceId.length === 0 ? await sdk.render.getDefaultVoiceSample() : await sdk.render.getVoiceSample(voiceId);

    // The route documents a 304 because the conditional-GET middleware can produce one, and the
    // generated client types it as an arm of the union. This caller never sends a validator, so
    // there is nothing for the server to match and nothing cached to fall back on if it somehow
    // did — which makes an empty answer a real failure rather than a case to handle silently.
    if (result.status !== 200)
        throw new Error(`the sample for "${voiceId === '' ? 'the default voice' : voiceId}" came back with no audio (${result.status})`);

    return URL.createObjectURL(result.data);
}

/**
 * Speak the caller's own words and hand back an object URL to play them with.
 *
 * The blob rationale of {@link fetchVoiceSample} exactly: the console holds its bearer token in
 * memory and an `<audio src>` sends no Authorization header, so the bytes come through the SDK.
 *
 * Unlike the sample, this route declares only a 200 — there is no conditional-GET middleware on a
 * POST and so no status to branch on. A failure arrives as a thrown error, which is what the caller
 * wants anyway.
 *
 * The caller owns the URL and must `revokeObjectURL` it. `useVoicePreview` does.
 */
export async function fetchSpeechPreview(text: string, voice?: string): Promise<string> {
    const result = await sdk.render.previewSpeech({ text, ...(voice === undefined ? {} : { voice }) });

    return URL.createObjectURL(result.data);
}
