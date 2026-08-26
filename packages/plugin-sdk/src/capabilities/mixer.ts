/**
 * The `mixer` capability. A mixer plugin takes several pieces of audio and
 * answers with one.
 *
 * ## Why this is not the analysis capability
 *
 * It was, for one commit, as an optional `joinAudio` method on
 * {@link AnalysisProvider}. The argument was that joining and measuring are the
 * same work seen from the other end: both need decoded PCM, which is the one
 * thing this tree does not do in Node, so both want the same adapter over the
 * same program. **That argument is about the ADAPTER and it is still true** —
 * the bundled plugin declares both capabilities and serves them off one sidecar
 * with one address.
 *
 * It is not an argument about the CONTRACT, because a capability here is the unit
 * of SELECTION rather than the unit of implementation. The host picks one plugin
 * per capability, so a joiner reached through the analysis pick is whichever
 * plugin the operator chose to MEASURE with: install a second analyzer that
 * measures better and cannot join, name it, and the station stops joining with
 * one log line, and the only fix is to select a worse analyzer. Filtering the
 * analysis candidates on the method instead would produce a second, disagreeing
 * pick under one key, which is exactly the failure the host's plugin selection
 * exists to prevent.
 *
 * So there are two keys. A station may measure with one engine and mix with
 * another, and a plugin that only mixes — a filter-graph adapter with no detector
 * in it — is a valid installation rather than an unexpressible one.
 *
 * ## The plugin is an adapter, not a mixer
 *
 * {@link AnalysisProvider}'s note applies here word for word and for the same
 * reason: joining needs decoded PCM, and the expected implementation is a thin
 * adapter over a separate program. Nothing here requires that shape.
 *
 * Every shape here is JSON-safe except {@link JoinedAudio}, which carries a live
 * stream deliberately. Offsets and durations are integer milliseconds.
 */

import type { PluginLifecycle } from '../plugin.lifecycle.js';

/**
 * Several pieces of audio to be made into one.
 *
 * The station's own use is a production: a phone-in or a podcast is written one
 * beat at a time, because a beat is one model call in one voice, and joining the
 * beats once they exist is what lets the programme air as ONE item with a pause
 * between turns that somebody chose. See {@link MixerProvider.join}.
 */
export interface AudioJoin {
    /**
     * The parts, in the order they are to be heard.
     *
     * Each URL is complete and fetchable exactly as an analysis `audioUrl` is,
     * and carries whatever authentication it needs. It has to be reachable from
     * wherever the joining happens, which is not necessarily where this plugin
     * runs.
     */
    parts: Array<{ url: string }>;

    /**
     * How much silence to put BETWEEN the parts, in milliseconds.
     *
     * Between, and never at the ends: what comes back is one item in a running
     * order, and padding its head or tail is dead air at a boundary somebody
     * else already trims.
     */
    gapMs: number;

    /**
     * Take each part's own leading and trailing silence off before joining.
     *
     * Absent means yes, because it is what makes {@link gapMs} mean anything: a
     * gap between two untrimmed parts is that gap plus two unknowns that move
     * with the voice and with the line. Set it false only where the parts are
     * known to be tight already and their exact lengths matter.
     */
    trim?: boolean;
}

/**
 * The joined audio, and what it is.
 *
 * `SpeechHandle`'s shape, deliberately and for its reasons: `mime` is what the
 * host stores and serves the bytes under, and the audio is a stream so a whole
 * programme is never held in memory on either side of the call.
 */
export interface JoinedAudio {
    /**
     * What the bytes ARE, as a media type (`audio/flac`).
     *
     * Load-bearing rather than decoration, exactly as it is for speech: both
     * consumers of station audio go by the header rather than by the bytes, so a
     * flac announced as `audio/wav` fails as silence rather than as an error.
     */
    mime: string;

    /** The audio. The host reads it to the end or cancels it. */
    audio: ReadableStream<Uint8Array>;

    /**
     * How long the result runs, if the joiner can say.
     *
     * Worth reporting because whatever just did the joining has already seen
     * every sample, and a host that has to learn this some other way is a second
     * decode of something it just received. Absent is fine.
     */
    durationMs?: number;
}

/** A plugin that can make one piece of audio out of several. */
export interface MixerProvider extends PluginLifecycle {
    /**
     * Join several pieces of audio into one.
     *
     * **Required, where it was optional as `analyzeTrack`'s neighbour.** It was
     * optional because it was a bolt-on to a capability that meant something
     * else, and a plugin that declared `analysis` and could not join was the
     * ordinary case. A plugin that declares THIS capability and cannot mix is not
     * a state worth being able to express, so the host's "declared and
     * implemented" check covers it like any other capability's one method.
     *
     * A station with no mixer at all is still an ordinary state rather than a
     * fault: a production whose beats cannot be joined airs as a block of beats,
     * which is what it did before anything could join them.
     *
     * Expect minutes rather than seconds — decoding several parts is not a
     * request, it is a job — but honour `host.signal` all the same, because a
     * station shutting down should not wait on a programme nobody will hear.
     *
     * @throws {PluginError} `config` when the plugin is not set up enough to try,
     *   `upstream` when a part could not be fetched or decoded, `unsupported`
     *   when whatever is behind this plugin cannot join what it was given,
     *   `timeout` when it did not answer.
     */
    join(request: AudioJoin): Promise<JoinedAudio>;
}
