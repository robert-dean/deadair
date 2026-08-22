import { useEffect, useRef, useState } from 'react';

import { apiErrorMessage } from '../../api/sdk.error';

/**
 * Playing one preview at a time, wherever a voice is chosen.
 *
 * Three surfaces want this — the voices list, a persona card, and the voice picker inside the
 * editor — and each of them had exactly one thing to say about a voice that was not the sound of
 * it. What they share is not the fetch but the LIFECYCLE around it: one element playing at a time,
 * an object URL that pins its blob until it is revoked, a pause that pauses rather than restarts,
 * and a failure that belongs to the row that asked.
 *
 * The fetcher is a parameter rather than the sample route, because the same lifecycle covers a voice
 * saying its fixed line and a script being heard before it airs. What the caller passes back is an
 * object URL, and this owns it from then on.
 *
 * `key` is whatever the caller draws its buttons by — a voice id here, a persona id there. It is
 * compared and never interpreted, so two surfaces on one page can each hold their own hook and
 * neither has to know the other's vocabulary.
 */
export function useVoicePreview(): VoicePreview {
    const [loading, setLoading] = useState<string | undefined>(undefined);
    const [playing, setPlaying] = useState<string | undefined>(undefined);
    const [failure, setFailure] = useState<{ key: string; message: string } | undefined>(undefined);

    const audio = useRef<HTMLAudioElement | undefined>(undefined);
    const objectUrl = useRef<string | undefined>(undefined);

    /** An object URL pins its blob until it is revoked, so every one this mints is released. */
    const release = () => {
        if (objectUrl.current !== undefined) URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = undefined;
    };

    useEffect(() => {
        return () => {
            audio.current?.pause();
            release();
        };
    }, []);

    const play = async (key: string, fetcher: () => Promise<string>, fallback: string) => {
        // A button drawn as a pause has to pause. Falling through to the fetch stopped the audio and
        // started the same thing again from the top, which is a restart wearing a pause's clothes.
        if (playing === key) {
            audio.current?.pause();
            setPlaying(undefined);
            return;
        }

        audio.current?.pause();
        release();
        setFailure(undefined);
        setPlaying(undefined);
        setLoading(key);

        try {
            const url = await fetcher();
            objectUrl.current = url;

            const element = new Audio(url);
            element.addEventListener('ended', () => setPlaying(undefined), { once: true });
            audio.current = element;

            await element.play();
            setPlaying(key);
        } catch (error) {
            setFailure({ key, message: apiErrorMessage(error, fallback) });
        } finally {
            setLoading(undefined);
        }
    };

    return {
        isLoading: (key: string) => loading === key,
        isPlaying: (key: string) => playing === key,
        failureFor: (key: string) => (failure?.key === key ? failure.message : undefined),
        play: (key, fetcher, fallback) => {
            void play(key, fetcher, fallback);
        },
    };
}

export interface VoicePreview {
    /** Whether this one is waiting on its audio, which the first time round is a synthesis. */
    isLoading: (key: string) => boolean;
    isPlaying: (key: string) => boolean;
    /** Why this one could not be heard, for the surface to draw beside the thing that failed. */
    failureFor: (key: string) => string | undefined;
    play: (key: string, fetcher: () => Promise<string>, fallback: string) => void;
}
