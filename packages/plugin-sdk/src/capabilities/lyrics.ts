import type { TrackRef } from './enrichment.js';

/**
 * The `lyrics` kind. A lyrics plugin finds the words of a record, and the
 * timings of its lines when its source has them.
 *
 * ## Read by the host, and never said
 *
 * A lyric is somebody's copyrighted text in full, and it is the one kind of
 * enrichment the station must never do what it does with everything else to:
 * say it out loud. Every other payload a plugin hands over exists to be spoken
 * or shown. This one exists to be read by the host and by nothing else, so the
 * host keeps it in a table of its own, never serves it on the wire, never
 * extracts a fact from it and never puts it in a prompt a deterministic writer
 * reads.
 *
 * That is also why this is a capability of its own rather than a field on
 * `TrackEnrichment`. Enrichment is merged last-wins by priority and served to
 * the console; a plain lyric from one source and a synced lyric from another
 * are two artifacts the station wants both of, and neither belongs on a page.
 *
 * ## What the host does with it
 *
 * The timings are the point. A synced line is a timestamp somebody typed while
 * listening, so the first one says when the singing starts and the last one
 * when it stops, which is what a presenter talking up a record needs and what
 * nothing measured from the audio answers cleanly. The text itself is read to
 * DERIVE labels (what a record is about, what mood it is in), and the labels
 * are what the rest of the station sees.
 *
 * ## Matching is the silent failure
 *
 * A lyric matched to the wrong recording does not error: it yields a confident
 * wrong vocal onset and a confident wrong set of labels. Match strictly, send
 * the duration whenever the source keys on one, and answer a near miss with
 * `{}` rather than with the closest thing found. A source that refuses this
 * client should throw rather than answer `{}`, because a refusal that reads as
 * a miss is an empty library nobody is told about.
 */

/**
 * One timed line.
 *
 * `atMs` is the line's start, in milliseconds from the start of the recording.
 * `endMs` is its end when the source publishes one; leave it unset rather than
 * guessing, because the host derives an end from the next line's start and a
 * guessed one would be believed.
 */
export interface LyricLine {
    atMs: number;
    endMs?: number;
    text: string;
}

/**
 * What a source knows about one record's words. Return `{}` on no match.
 *
 * - `plain`: the words without timings. Set it whenever the source has them,
 *   even beside `synced`, because the labels are derived from the plain text.
 * - `synced`: the timed lines, in the order the source gives them.
 * - `instrumental`: the source says this record has no words. That is an
 *   ANSWER, different from a miss: the host stops looking and treats the record
 *   as one nobody sings on. Leave `plain` and `synced` unset with it.
 * - `language`: a BCP 47 tag, when the source states one. Do not guess it.
 * - `providerRef`: the source's own id for what it matched, for provenance.
 */
export interface TrackLyrics {
    plain?: string;
    synced?: LyricLine[];
    instrumental?: boolean;
    language?: string;
    providerRef?: string;
}

export interface LyricsProvider {
    /**
     * Lower is asked first. The same meaning as `EnrichmentProvider.priority`,
     * and the same caveat: it is this plugin's own view of its source, and an
     * operator who knows better says so with `lyrics.providerOrder`.
     */
    priority: number;

    /** The words of one record, or `{}` when the source has nothing it is sure of. */
    lyricsFor(ref: TrackRef): Promise<TrackLyrics>;
}
