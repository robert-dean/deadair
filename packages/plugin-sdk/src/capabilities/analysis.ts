/**
 * The `analysis` capability. An analysis plugin takes one track's audio and
 * answers with measurements of it: where the record actually starts, where it is
 * underway, where the ending begins, where it stops.
 *
 * ## Why this is not enrichment
 *
 * Enrichment asks an upstream what it KNOWS about a recording, fans the question
 * out to everything that answers, and merges the results in priority order.
 * Nothing here works that way. There is no upstream that knows where a record's
 * outro begins — it is computed from the samples — so there is exactly one
 * answer, one source, and nothing to merge. `TrackRef` also carries no way to
 * reach the audio, deliberately, because no enrichment source wants it.
 *
 * ## The plugin is an adapter, not an analyzer
 *
 * Measuring any of this needs decoded PCM, and decoding is the one thing this
 * tree does not do in Node. So the expected implementation is a thin adapter over
 * a separate program: take {@link AnalysisRef.audioUrl}, hand it to whatever
 * actually decodes, return what comes back. That is the same relationship the
 * bundled speech plugin has with its engine, and it is also a materially
 * different licence position from linking a beat-detection toolkit into the API
 * process, which matters because the usual licence in this space is copyleft.
 *
 * Nothing here requires that shape. A plugin that can measure audio some other
 * way is a valid implementation; this note exists so the first one is not
 * mistaken for the contract.
 *
 * ## What the host guarantees, and what it cannot
 *
 * The host resolves {@link AnalysisRef.audioUrl} because a plugin cannot: the
 * copy that can actually be served is a binding the catalog owns, and asking one
 * plugin to go through another is not a thing the host permits. In exchange the
 * host cannot see the bytes, so it cannot tell a complete download from a
 * truncated one — which is why {@link TrackAnalysis.complete} is reported rather
 * than inferred. See the note on that field: it is the difference between a cache
 * that can be trusted and one that cannot.
 *
 * Every shape here is JSON-safe. Offsets are integer milliseconds.
 */

import type { PluginLifecycle } from '../plugin.lifecycle.js';

/**
 * The current shape of {@link TrackAnalysis.data}.
 *
 * Bumped whenever a detector's output changes shape or a field is added, which
 * is what lets a stored row be recognised as STALE rather than read as missing
 * or, worse, as current. Reanalysis then falls out of an ordinary "needs work"
 * query instead of needing a migration.
 *
 * The host compares this against what it stored, so a plugin must report the
 * version it actually produced rather than this constant, in case the two have
 * drifted apart across an upgrade.
 */
export const ANALYSIS_SCHEMA_VERSION = 1;

/**
 * How the host asks about one track.
 *
 * Deliberately not a {@link TrackRef}: nothing here is matched by name, so
 * artist and title would be decoration. What a measurement needs is bytes and a
 * way to tell a truncation from a short record.
 */
export interface AnalysisRef {
    /**
     * The canonical catalog id for this track.
     *
     * Passed for the plugin's own logging and for its own caching, if it keeps
     * any. It is not a key into anything the plugin can read, and the host does
     * not expect it back.
     */
    trackId: string;

    /**
     * A complete, fetchable URL for the audio, resolved by the host.
     *
     * Carries its own authentication, exactly as the playout URLs do: whatever
     * fetches this sends no headers on the host's behalf. It may be short-lived,
     * so fetch it during the call rather than storing it.
     *
     * **It has to be reachable from wherever the decoding happens**, which is not
     * necessarily where this plugin runs. An address that resolves inside the
     * API process and not inside a sidecar container is the first thing to check
     * when every analysis fails at once.
     */
    audioUrl: string;

    /**
     * How long the catalog believes the track is.
     *
     * A cross-check rather than an input to any measurement: audio that decodes
     * to appreciably less than this was truncated, and measuring it would report
     * a confident cold ending for a record that fades. Absent when the catalog
     * never learned a duration, which is ordinary and is not a reason to refuse.
     */
    durationMs?: number;
}

/**
 * The four points, all absolute offsets into the file.
 *
 * Including `cueOut`. Storing it relative to `cueIn` is the obvious-looking
 * choice and it is wrong: everything downstream seeks in file time, so a relative
 * figure has to be re-based at every read, and eventually one read does not.
 *
 * Two lengths fall out — `intro = introEnd - cueIn` and
 * `outro = cueOut - outroStart` — and they are what a transition is actually
 * sized from. Neither is stored, because a stored derivation is a second thing
 * that can disagree with the first.
 */
export interface TrackCuePoints {
    /** Where audio actually starts, past the leading silence. */
    cueIn: number;

    /**
     * Where the record is fully underway: the beat established, or the vocal in.
     *
     * The talk-up limit, and one of the two points that is real work. A detector
     * weighted to low frequencies places this early on a record that opens with
     * a pad, which reads as "the intro is over" while it plainly is not.
     */
    introEnd: number;

    /**
     * Where the ending begins, so the earliest a blend may start.
     *
     * The other real one, and the one with a specific failure to design against:
     * a low-frequency-weighted detector places it too early on a quiet ending,
     * which is exactly the case an ending-aware transition exists to serve.
     */
    outroStart: number;

    /** Where audio actually stops, before the trailing silence. */
    cueOut: number;
}

/**
 * How loud the record is, and how close it already runs to its ceiling.
 *
 * Every field is OPTIONAL, and absent is a real answer rather than a gap: a
 * silent or near-silent track has no loudness, and the alternative to omitting
 * it is a floor value like -80 that a caller would then "correct" by fifty
 * decibels. Absent means no opinion, which is what every consumer of these
 * measurements already has to handle.
 *
 * They are also optional in the weaker sense that an analyzer may not compute
 * them at all. A plugin that only finds cue points is a valid analyzer; a
 * station reading these has to degrade to its live normalizer, which is what it
 * does today anyway.
 */
export interface TrackLoudness {
    /**
     * Gated programme loudness in LUFS, to ITU-R BS.1770.
     *
     * Gated, which is the whole difference between this and an average level: a
     * record with a long quiet outro is as loud as its body, not as loud as its
     * mean. The station's per-track gain is the distance from this to whatever
     * target it holds.
     */
    integratedLufs?: number;

    /**
     * The highest inter-sample peak in dBTP, which is what caps a boost.
     *
     * Distinct from {@link samplePeakDb} and the distinction is the point: the
     * reconstructed waveform between two samples can exceed both of them,
     * routinely by around a decibel. A gain computed against sample peak alone
     * is how a quiet master gets lifted into clipping, so this is the number a
     * boost has to respect.
     *
     * Legitimately positive. A value above 0 dBTP means the master already
     * overshoots on playback, which is worth knowing before adding anything.
     */
    truePeakDb?: number;

    /**
     * The highest actual sample, in dBFS.
     *
     * Carried alongside the true peak rather than instead of it, because the gap
     * between them is diagnostic: a wide one means the master is already fighting
     * its own ceiling.
     */
    samplePeakDb?: number;
}

/**
 * What one analysis produced.
 *
 * `data` is deliberately the only place measurements live, and the host stores
 * it whole without reading the individual fields. That is what lets a later
 * schema version add a beat grid or a vocal curve without touching the plugin
 * contract, the host, or the database.
 */
export interface TrackAnalysis {
    /**
     * The shape of {@link data}, as this plugin actually produced it.
     *
     * Report what was measured rather than {@link ANALYSIS_SCHEMA_VERSION}: an
     * adapter over a separate analyzer is reporting that analyzer's version, and
     * the two drift the moment one of them is upgraded and the other is not. A
     * version the host does not know is a configuration problem it can name,
     * where a wrong one is a row nothing can read and nothing can explain.
     */
    schemaVersion: number;

    /**
     * Whether the whole file was measured.
     *
     * **Load-bearing, and the host cannot check it.** A byte-capped, idle-timed
     * out or otherwise truncated download produces perfectly confident
     * measurements of a file that was never the track, and the specific lie it
     * tells is that a record which fades ended cold. Since the host never sees
     * the bytes, this is the only signal that separates a measurement worth
     * keeping from one worth discarding, and a plugin that always answers `true`
     * has quietly disabled the check.
     *
     * A genuinely short track is `true`. A download that stopped early is
     * `false`, and the two are told apart with {@link AnalysisRef.durationMs}
     * where there is one.
     */
    complete: boolean;

    /**
     * The measurements, in the shape {@link schemaVersion} names.
     *
     * Typed as the v1 fields plus room to grow rather than as a closed
     * interface, because the host passes it through unread. A v2 payload with a
     * tempo and a downbeat grid is the same call, the same plugin method, and a
     * different number above.
     *
     * The cue points are required and the loudness is not, which reflects what
     * each costs to produce: the points come from the decode that has already
     * happened, where loudness needs a filter chain an analyzer may reasonably
     * not implement.
     */
    data: TrackCuePoints & TrackLoudness & Record<string, unknown>;

    /**
     * How long the audio turned out to be once decoded.
     *
     * The honest figure, as opposed to the catalog's claim in
     * {@link AnalysisRef.durationMs}. Worth reporting even when the two agree:
     * where they do not, this is the one that the offsets above are on the same
     * timeline as.
     */
    durationMs?: number;

    /**
     * What did the measuring, as a name and version.
     *
     * Stored as provenance, so a row can be attributed after the fact when a
     * detector turns out to have been wrong about a class of records. Free-text
     * and never parsed.
     */
    analyzer?: string;
}

/** A plugin that can measure a track's audio. */
export interface AnalysisProvider extends PluginLifecycle {
    /**
     * Measure one track.
     *
     * One track per call, with no batch sibling: the unit of work is one file's
     * bytes, and there is no upstream round trip to amortise across several. How
     * many run at once is the host's decision, taken against hardware it can see
     * and this plugin cannot.
     *
     * Expect to be given minutes rather than seconds — decoding a full record is
     * not a request, it is a job — but honour `host.signal` all the same, because
     * a station shutting down should not wait on a measurement nobody will read.
     *
     * @throws {PluginError} `config` when the plugin is not set up enough to try
     *   (no analyzer address), `upstream` when the audio could not be fetched or
     *   could not be decoded, `timeout` when the analyzer did not answer.
     */
    analyzeTrack(ref: AnalysisRef): Promise<TrackAnalysis>;
}
