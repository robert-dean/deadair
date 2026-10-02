/**
 * The `transcode` capability. A transcode plugin takes one piece of audio and
 * answers with a smaller copy of it.
 *
 * ## What it is for
 *
 * A copy made to be SENT rather than aired. A talk break is rendered as whatever
 * the speech engine produced, which is often wav at three megabytes a minute, and
 * a listener sharing one by text message needs something a plain MMS will carry.
 * The station asks for that copy once per break and keeps it for a while; nothing
 * this capability answers ever goes back into the programme, which is why it may
 * be lossy where a join may not.
 *
 * ## Why it is not the mixer, or the analysis capability
 *
 * `mixer.ts` argues it in full, and the argument carries over unchanged: a
 * capability is the unit of SELECTION. Carried as a method on the mixer, the
 * plugin making shareable copies would be whichever plugin the operator chose to
 * JOIN with, and a better joiner that cannot encode would take sharing away. The
 * bundled analyzer declares all three and serves them off one sidecar; that is a
 * fact about the adapter, not the contract.
 *
 * ## The plugin is an adapter, not an encoder
 *
 * Encoding does not happen in Node, so the expected implementation is a thin
 * adapter over a separate program, as it is for analysis and mixing. Nothing
 * here requires that shape.
 *
 * Every shape here is JSON-safe except {@link TranscodedAudio}, which carries a
 * live stream deliberately. Durations are integer milliseconds.
 */

import type { PluginLifecycle } from '../plugin.lifecycle.js';

/**
 * One piece of audio to be made smaller.
 *
 * The numbers are the HOST's decision, carried here so it is made in one place:
 * the station names a purpose to its clients ("a copy to share") and turns that
 * into these, so an implementation is never the one deciding how small is small.
 */
export interface AudioTranscode {
    /**
     * The audio, complete and fetchable exactly as a mixer part's url is, and
     * carrying whatever authentication it needs. It has to be reachable from
     * wherever the encoding happens, which is not necessarily where this plugin
     * runs.
     */
    url: string;

    /** The bitrate to encode at, in kilobits per second. */
    bitrateKbps: number;

    /** How many channels the copy has: `1` for mono, `2` for stereo. */
    channels: number;
}

/**
 * The copy, and what it is.
 *
 * {@link JoinedAudio}'s shape, for its reasons: `mime` is what the host stores
 * and serves the bytes under, and the audio is a stream the host reads to the
 * end or cancels.
 */
export interface TranscodedAudio {
    /**
     * What the bytes ARE, as a media type (`audio/mp4`).
     *
     * The host checks it rather than trusting it to be what it asked for: a copy
     * announced as one thing and stored as another is served wrongly to everybody
     * who asks for it afterwards.
     */
    mime: string;

    /** The audio. The host reads it to the end or cancels it. */
    audio: ReadableStream<Uint8Array>;

    /** How long the copy runs, if the encoder can say. Absent is fine. */
    durationMs?: number;
}

/** A plugin that can make a smaller copy of a piece of audio. */
export interface TranscodeProvider extends PluginLifecycle {
    /**
     * Make a smaller copy of one piece of audio.
     *
     * Required, on the mixer's argument: a plugin declaring this capability that
     * cannot encode is not a state worth being able to express. A station with
     * no transcoder at all is an ordinary one: a listener asking for a copy to
     * share is told the station cannot make one, and everything else carries on.
     *
     * Seconds rather than minutes for the talk this exists for, but honour
     * `host.signal` all the same.
     *
     * @throws {PluginError} `config` when the plugin is not set up enough to try,
     *   `upstream` when the audio could not be fetched or decoded, `unsupported`
     *   when whatever is behind this plugin cannot encode, `timeout` when it did
     *   not answer.
     */
    transcode(request: AudioTranscode): Promise<TranscodedAudio>;
}
