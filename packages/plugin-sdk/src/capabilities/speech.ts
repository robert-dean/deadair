/**
 * The `speech` capability. A speech plugin takes a line of text and answers
 * with audio: the station saying its own name, reading a back-announce, or
 * delivering a whole talk break.
 *
 * ## The audio comes back as a stream, not as a value
 *
 * {@link SpeechPluginInstance.speak} returns a stream rather than bytes, and
 * the usual implementation is to hand back the `host.fetch` body of the engine
 * call unchanged. So the audio is never held whole anywhere, and a long script
 * costs a chunk of memory rather than a file of it.
 *
 * Cancellation is the host's `cancel()` on that stream, and forwarding a
 * `host.fetch` body propagates it to the socket for you. There is nothing to
 * implement.
 *
 * ## A voice is a name the station chose, not one your engine knows
 *
 * {@link SpeechRequest.voice} is an opaque id from the station's side of the
 * fence — `host`, `newsreader` — and mapping it to whatever your engine actually
 * takes is your job, out of your own config. The host never reads it, never
 * validates it, and never stores anything engine-specific.
 *
 * The indirection is the point, and it was paid for once already: it is what
 * lets the same station voice be a named preset on one engine and a cloned
 * reference clip on another, so changing engine does not rewrite every persona.
 * Keep engine-specific tuning (an expressiveness dial, a similarity weight)
 * inside your own config where it belongs, rather than asking the host to carry
 * knobs only you understand.
 *
 * Every shape here is JSON-safe.
 */

import type { PluginLifecycle } from '../plugin.lifecycle.js';

/** One thing to say. */
export interface SpeechRequest {
    /**
     * The words, already final. Nothing downstream rewrites them, so any
     * pronunciation fixing your engine needs is yours to apply.
     */
    text: string;

    /**
     * Which station voice to use, or absent for this plugin's default.
     *
     * Opaque, and a name the operator chose. An id you have no mapping for
     * should fall back to your default rather than fail: a missing voice is
     * worth a `logger.warn` and a rendered line, not a silent station.
     */
    voice?: string;

    /**
     * The audio format the caller would prefer, as a bare extension (`mp3`).
     *
     * A hint, and the weakest thing in this interface: answer with whatever you
     * actually produced in {@link SpeechHandle.mime} and the host will believe
     * that instead. Ignore it entirely if your engine emits one format.
     */
    format?: string;
}

/** The audio for one {@link SpeechPluginInstance.speak}, and what it is. */
export interface SpeechHandle {
    /**
     * What the bytes ARE, as a media type (`audio/mpeg`).
     *
     * Load-bearing rather than decoration: it is what the host stores the audio
     * under and what it later serves, and both consumers of station audio (a
     * browser's `<audio>`, which does not sniff, and the playout engine, which
     * picks its decoder from the content type) go by that header rather than by
     * the bytes. A wav announced as `audio/mpeg` fails as silence rather than
     * as an error anybody sees.
     */
    mime: string;

    /**
     * The audio.
     *
     * The host reads it to the end or cancels it, and either one releases
     * whatever is underneath. Usually a `host.fetch` body forwarded unchanged,
     * which is what makes that true for free.
     */
    audio: ReadableStream<Uint8Array>;
}

/** One voice this plugin can be asked for. */
export interface SpeechVoice {
    /** The id to pass back as {@link SpeechRequest.voice}. */
    id: string;

    /** What the console calls it. */
    label: string;

    /** Anything worth knowing when choosing between them: an accent, a register. */
    description?: string;

    /**
     * An opaque token that changes when what this voice SOUNDS LIKE changes.
     *
     * The host does not interpret it, parse it, store it or show it. It uses it
     * for one thing: keying the cached preview at `GET /voices/{id}/sample`, so
     * that remapping `host` from one engine voice to another — or nudging its
     * speed, or swapping its reference clip — mints a new key and the next
     * preview renders instead of playing the old voice back.
     *
     * That was already the claim `VoiceSampleStore` made in its own doc comment
     * and it was not true: the key held the STATION voice id, which is exactly
     * the part that does not change when an operator edits the mapping under it.
     * The fence is intact because this stays opaque — whatever string identifies
     * a rendering to you is the right value, and `engineVoice@speed` is a fine
     * one.
     *
     * Absent is normal. A plugin that omits it keys previews as it always did,
     * which is correct for one whose voices cannot be reconfigured.
     */
    spec?: string;
}

/** A plugin that can speak. */
export interface SpeechPluginInstance extends PluginLifecycle {
    /**
     * Start turning `request.text` into audio.
     *
     * May return before any audio exists, because the handle carries a stream
     * and not the bytes, so a slow engine shows up as a slow first chunk rather
     * than as a slow `speak`.
     *
     * @throws {PluginError} `config` when the plugin is not set up enough to try
     *   (no server address), `upstream` when the engine refused or answered with
     *   something that is not audio, `timeout` when it did not answer at all.
     */
    speak(request: SpeechRequest): Promise<SpeechHandle>;

    /**
     * The voices this plugin can be asked for, for a console that has to draw a
     * list.
     *
     * Optional, because a plugin with exactly one voice is a legitimate thing to
     * be and should not have to describe it. Absent is normal, not broken.
     */
    listVoices?(): Promise<SpeechVoice[]>;
}
