// The floor every speech plugin puts on the end of its engine's body. What matters is WHERE it fails:
// at the end of the stream rather than on the first chunk, so a short error dribbled out in pieces is
// still caught, and never on a real line however it is chunked.

import { describe, expect, it } from 'vitest';

import { MIN_PLAUSIBLE_AUDIO_BYTES, plausibleAudio, type PlausibleAudioOptions } from '../src/plausible.audio.js';
import { PluginError } from '../src/plugin.error.js';

describe('plausibleAudio', () => {
    const KOKORO: PlausibleAudioOptions = { engine: 'kokoro', asked: 'voice "host"' };

    /** How many bytes `chunks` come to once piped through the check; rejects with whatever it threw. */
    const drain = async (chunks: Uint8Array[], options: PlausibleAudioOptions = KOKORO): Promise<number> => {
        const source = new ReadableStream<Uint8Array>({
            start(controller) {
                for (const chunk of chunks) controller.enqueue(chunk);
                controller.close();
            },
        });

        let total = 0;
        for await (const chunk of source.pipeThrough(plausibleAudio(options))) total += chunk.byteLength;
        return total;
    };

    it('passes a real line through untouched', async () => {
        expect(await drain([new Uint8Array(MIN_PLAUSIBLE_AUDIO_BYTES)])).toBe(MIN_PLAUSIBLE_AUDIO_BYTES);
    });

    it('counts across chunks rather than judging the first one', async () => {
        const dribble = Array.from({ length: 8 }, () => new Uint8Array(MIN_PLAUSIBLE_AUDIO_BYTES / 8));
        expect(await drain(dribble)).toBe(MIN_PLAUSIBLE_AUDIO_BYTES);
    });

    it('fails a short body as an upstream error naming the engine and what it was asked for', async () => {
        const error = await drain([new TextEncoder().encode('{"detail":"no such voice"}')]).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(PluginError);
        expect((error as PluginError).code).toBe('upstream');
        expect((error as PluginError).message).toBe('kokoro returned only 26 bytes for voice "host", which is not audio');
    });

    it('fails an empty body', async () => {
        await expect(drain([])).rejects.toThrow('kokoro returned only 0 bytes');
    });

    it('appends the advice after a colon when there is some', async () => {
        await expect(drain([], { ...KOKORO, advice: 'check the model and voice' })).rejects.toThrow(
            'kokoro returned only 0 bytes for voice "host", which is not audio: check the model and voice',
        );
    });
});
