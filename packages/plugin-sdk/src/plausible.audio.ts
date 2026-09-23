/**
 * The size check a speech plugin puts on the end of its engine's body.
 *
 * Every speech engine the station speaks through can answer 200 with a short JSON complaint instead
 * of audio, and every speech plugin carried its own copy of the same check until this. It lives here
 * rather than in `capabilities/speech.ts` because it is plugin-side help, not part of the contract:
 * the host never sees it, only the stream it wraps. See README § "Speaking".
 */

import { PluginError } from './plugin.error.js';

/**
 * Below this, what an engine sent back is a JSON error page or an empty reply, not audio.
 *
 * Ported from v1, where it was paid for: a server that answers 200 with a complaint about the voice
 * produces a segment that airs as a click, and the plugin is the only place left to notice. A real
 * line is tens of kilobytes, so the floor is nowhere near anything a working engine sends.
 */
export const MIN_PLAUSIBLE_AUDIO_BYTES = 256;

/** What {@link plausibleAudio} names in the error it throws. */
export interface PlausibleAudioOptions {
    /** The engine, as the operator knows it: `kokoro`. Starts the message. */
    engine: string;
    /** What it was asked for: `voice "host"`. */
    asked: string;
    /** What to check, appended after a colon: `check the model and voice`. */
    advice?: string;
}

/**
 * A pass-through for a speech engine's body that fails it if it ends under
 * {@link MIN_PLAUSIBLE_AUDIO_BYTES}.
 *
 * The check belongs at the END rather than on the first chunk: a server can dribble a short JSON
 * error out in several pieces, and "was any of this plausibly audio" is only answerable once it
 * stops. Failing in `flush` is what makes the render fail loudly instead of storing a click, with an
 * `upstream` {@link PluginError} the host reports like any other engine failure.
 *
 * A `TransformStream` rather than a wrapper, so the host cancelling the result still cancels the
 * socket underneath without anything here to forward it:
 *
 * ```ts
 * return { mime, audio: response.body.pipeThrough(plausibleAudio({ engine: 'kokoro', asked: `voice "${voice}"` })) };
 * ```
 */
export function plausibleAudio({ engine, asked, advice }: PlausibleAudioOptions): TransformStream<Uint8Array, Uint8Array> {
    let delivered = 0;

    return new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            delivered += chunk.byteLength;
            controller.enqueue(chunk);
        },
        flush() {
            if (delivered >= MIN_PLAUSIBLE_AUDIO_BYTES) return;
            const message = `${engine} returned only ${delivered} bytes for ${asked}, which is not audio`;
            throw new PluginError(advice === undefined ? message : `${message}: ${advice}`).withCode('upstream');
        },
    });
}
