/**
 * Liquidsoap's `annotate:` protocol: the metadata that rides through the player
 * on the pushed uri.
 *
 * It carries two different things, for two different audiences. The item id
 * comes back on the `on_track` notify and in every reading of the queue, which
 * is how the app learns what actually went on air rather than inferring it from
 * what it last handed over. The track's title and artist go the other way, out
 * to the listener: Liquidsoap is playing a file it fetched from a URL we handed
 * it, and for a Spotify item that file carries no usable tags at all, so
 * whatever the app says here is the only thing the mount can be labelled with.
 *
 * Neither failure mode is loud — a malformed annotation either fails to resolve
 * (silence) or resolves without the id (the notify goes missing) — so this is
 * kept pure and unit-tested.
 */

import { isRenderItem } from '#modules/render/segment.source.js';
import { blendFor } from './crossfade.js';
import { gainFor, speechGainFor, type MeasuredLoudness } from './gain.js';
import type { RundownItem } from './rundown.js';

/** The metadata key carrying the rundown item id. Must match `radio.liq`. */
export const ITEM_KEY = 'deadair_item';

/**
 * The metadata key saying this item is the station TALKING. Must match `radio.liq`.
 *
 * Nothing about the level: it says what the audio IS, and the mixer decides what
 * to do about it. What the mixer does today is switch a compressor on for the
 * duration of the item, because the playout queue carries records and breaks down
 * one chain and a compressor that suited both would suit neither — the settings
 * that tame a plosive would pump a record.
 *
 * A boolean expressed as a key that is either present or absent would be the
 * smaller stamp, but every other key here carries a value and `m["k"] == ""` is
 * also how Liquidsoap reports a key nobody set. `"1"` keeps absent and false the
 * same answer on the reading side, which is what a mixer wants.
 */
export const SPEECH_KEY = 'deadair_speech';

/**
 * What a boundary the station does not blend is stamped with, and it is
 * deliberately not zero. Must match `playout_cross_hard_join` in `radio.liq`.
 *
 * A `cross` sized at zero does not produce a hard join, it stops producing.
 * Read against Liquidsoap 2.4.5: with a zero duration the operator never
 * appends a frame to its buffer, so it never observes the end of the track, so
 * it never advances past buffering, and the source it hands out is never ready.
 * The station would fall through to the local music bed permanently on the
 * first item stamped this way, which is every item until something is measured.
 *
 * A tenth of a second is several frames, which keeps the state machine moving,
 * and is a hard join in every way a listener can tell.
 */
export const HARD_JOIN_MS = 100;

/** What an item's annotations depend on beyond the item itself. */
export interface AnnotationContext {
    /** Where the station wants its records to sit, in LUFS. See `gain.ts`. */
    targetLufs: number;
    /** How far under that a break is aimed, in dB. See `speechGainFor`. */
    speechTrimDb: number;
    /** Whether this broadcast blends one record into the next. See `crossfade.ts`. */
    crossfade: boolean;
    /**
     * What the running order says follows this item, if anything does.
     *
     * The one thing here that is not a fact about the item being stamped, and it
     * has to be: a blend is a property of the boundary, so the length cannot be
     * decided from either record alone.
     */
    next?: RundownItem;
    /**
     * The blend the PREVIOUS boundary was stamped with, in milliseconds.
     *
     * Carried forward by the pusher rather than recomputed, so the two ends of one
     * boundary cannot disagree. See {@link crossAnnotations} for why a boundary has
     * to be stamped twice at all.
     */
    previousBlendMs?: number;
}

/**
 * The annotations one item goes to the player with.
 *
 * `title`, `artist` and `album` are Liquidsoap's own metadata names, not ours:
 * `output.icecast` builds the ICY stream title out of what the source is
 * playing, so setting them here is what puts the track in a listener's player.
 * That is also why this is the labelling path: the label travels with the item,
 * so it changes on the boundary itself rather than being pushed after the fact.
 *
 * **It does not avoid Icecast's admin API, and an earlier version of this note
 * claimed it did.** On an MP3 mount there is no in-band metadata path for a
 * source client at all: whatever Liquidsoap is told, it delivers by calling
 * `/admin/metadata`, which is authorised against the MOUNT's own credentials.
 * That endpoint answered 401 on this station until `icecast.xml.tmpl` gave the
 * mount a `<username>`/`<password>` — see the comment there — and the symptom
 * was one this file would never have been suspected of: labels accepted and
 * silently dropped, while the annotations here were correct throughout.
 *
 * Empty values are left out rather than sent blank: an `artist=""` overwrites
 * whatever the file's own tags said with nothing, and for a local library those
 * tags are better than silence.
 *
 * What this looks like on the other side, measured against live mounts on both
 * generations: Icecast composes the ICY `StreamTitle` from the two and reports it
 * as ONE field, never as a split. Which field, and where, moved with 2.5:
 *
 * | Endpoint | 2.4.4 | 2.5.0 |
 * | --- | --- | --- |
 * | `/status-json.xsl` | `title`, `artist` null | `title` AND `display-title`, no `artist` at all |
 * | `/admin/publicstats.json` | — | `display-title` only, no `title` |
 *
 * So a check that the mount is labelled reads `display-title` where it exists and
 * `title` otherwise; expecting a separate artist finds nothing on either version
 * and looks like a fault that is not one. On 2.4 the unlabelled state is
 * recognisable instead by the artist arriving with no title, which is a file's own
 * tags showing through from the local bed.
 *
 * 2.5 also reports a `playlist` of recent titles on the mount, which is Icecast's
 * own history of what it was told. It is not the station's: the rundown knows what
 * aired, in order, with ids, and this is a lossy echo of the same thing.
 */
export function itemAnnotations(item: RundownItem, context: AnnotationContext): Record<string, string> {
    const artist = item.artists.join(', ');
    return {
        [ITEM_KEY]: item.id,
        ...(item.title ? { title: item.title } : {}),
        ...(artist ? { artist } : {}),
        ...(item.album ? { album: item.album } : {}),
        ...(isRenderItem(item) ? { [SPEECH_KEY]: '1' } : {}),
        ...cueAnnotations(item),
        ...gainAnnotations(item, context),
        ...crossAnnotations(item, context),
    };
}

/**
 * `liq_cue_in` / `liq_cue_out`: where the player should start and stop reading
 * the file.
 *
 * Liquidsoap's own annotation names, in SECONDS, which is the one conversion in
 * this file — everything the app holds is integer milliseconds and the player
 * takes a float. They trim the silence off the head and tail of a record, which
 * is the first audible thing the measurement in `deadair.track_analysis` buys and
 * needs no crossfade to be worth having: it changes where one item starts and
 * stops rather than how two of them overlap.
 *
 * **Stamped only when both are present and sane, and silently not otherwise.**
 * An unmeasured track has to play, so every rejection here is an ordinary state
 * rather than a fault: no measurement, one without the other, or a pair that
 * does not describe a forward span. That last check is the one worth keeping —
 * a `cue_out` at or before `cue_in` is a track the player would produce nothing
 * for, which is silence on air rather than an error anybody sees.
 *
 * `cue_in` at zero is deliberately omitted rather than sent as `0`. It is the
 * default, so sending it says nothing, and leaving it out keeps a legitimately
 * untrimmed record from looking like a measured one in a queue reading.
 */
function cueAnnotations(item: RundownItem): Record<string, string> {
    const { cueInMs, cueOutMs } = item;
    if (cueInMs === undefined || cueOutMs === undefined) return {};
    if (!Number.isFinite(cueInMs) || !Number.isFinite(cueOutMs)) return {};
    if (cueInMs < 0 || cueOutMs <= cueInMs) return {};

    return {
        ...(cueInMs > 0 ? { liq_cue_in: seconds(cueInMs) } : {}),
        liq_cue_out: seconds(cueOutMs),
    };
}

/** Milliseconds as the seconds Liquidsoap expects, without a trailing `.000`. */
const seconds = (ms: number): string => String(Math.round(ms) / 1000);

/**
 * `liq_amplify`: how much to lift or drop this record, decided before it airs.
 *
 * Liquidsoap's own name and its own default — `amplify`'s `override` parameter is
 * already `"liq_amplify"` — and, like the cue keys above, **it does nothing
 * without the operator in the graph to read it**. `radio.liq` puts an `amplify`
 * between `cue_cut` and `normalize` for exactly this.
 *
 * **The `dB` suffix is load-bearing.** The value is parsed as
 * `Scanf.sscanf s " %f dB"` with a fall back to `float_of_string`, so a bare
 * `-3.2` is not a quiet record, it is a LINEAR factor of minus three: the audio
 * inverted and amplified tenfold. The suffix is the whole difference between a
 * correction and a catastrophe, which is why the number is never formatted
 * anywhere but here.
 *
 * Absent for an unmeasured track, for a boost with no headroom to spend, and for
 * a correction too small to hear. See `gainFor`, which decides all three.
 */
function gainAnnotations(item: RundownItem, { targetLufs, speechTrimDb }: AnnotationContext): Record<string, string> {
    // A break the station wrote and spoke, which is a different level question from a record
    // somebody else mastered: see `speechGainFor`, and {@link voiceAnnotations} for the other
    // path the same audio can take to the player.
    if (isRenderItem(item)) return voiceAnnotations(item, targetLufs, speechTrimDb);

    const gainDb = gainFor(item, targetLufs);

    return gainDb === undefined ? {} : { liq_amplify: `${gainDb} dB` };
}

/**
 * `liq_amplify` for a break, whichever way it reaches the player.
 *
 * A break has TWO routes and they meet nothing in common downstream. Between two
 * records it is an ordinary running-order item, pushed onto the playout queue and
 * levelled by the `amplify` there. Over a record it is a cue armed against that
 * record, pushed onto the voice queue, and it goes through the mic chain instead
 * — a graph the playout queue's annotations never reach.
 *
 * So the gain is decided HERE, once, and both paths stamp what this returns. The
 * alternative was what the station actually did: a `VOICE_GAIN_DB` trim in
 * `radio.liq` that only the mic chain applied, which left a break between two
 * records ten decibels under the music with nothing in the mixer able to say so.
 *
 * Exported for the pusher, which arms the cue and has no `RundownItem` to hand.
 */
export function voiceAnnotations(measured: MeasuredLoudness, targetLufs: number, trimDb: number): Record<string, string> {
    return { liq_amplify: `${speechGainFor(measured, targetLufs, trimDb)} dB` };
}

/**
 * How long this record overlaps its neighbours, in seconds, on both sides.
 *
 * Liquidsoap's own names, and like the keys above **they do nothing without the
 * operator in the graph to read them**, meaning a `cross` in `radio.liq`.
 *
 * **TWO keys, not the combined `liq_cross_duration`.** That was the first
 * attempt and it produced no blend at all, on every boundary, measured on a
 * rendered transition. A boundary is made of two records; the combined key sets
 * both ends of ONE record. So the outgoing item said "blend four seconds" about
 * the boundary after it, the incoming item said "blend a tenth" about the
 * boundary after IT, `cross` applied both to the same transition, and the
 * shorter one won. Since a hard join is stamped on everything that does not
 * blend, and something that does not blend follows most things that do, that
 * collapsed essentially every boundary.
 *
 * Split, the same number is stamped twice and the two ends agree: as the
 * outgoing record's END buffer, and as the incoming record's START buffer.
 * Which is why {@link AnnotationContext} carries both the successor (to compute
 * the boundary after this item) and {@link AnnotationContext.previousBlendMs}
 * (the boundary before it, already computed one hand-over ago).
 *
 * **Always stamped**, which is the one line here that looks defensive and is
 * load-bearing. `cross` needs `persist_override=true` on 2.4 or the override is
 * reset before it sizes anything, and the flip side of persist is that a stamp
 * LINGERS over every later unstamped track. So an item without one would not be
 * a hard join, it would be a blend by whatever number the last measured record
 * happened to leave behind.
 *
 * That makes this the opposite call from `liq_cue_in` above, which is omitted at
 * zero. There the default is the same as the value and silence says it; here
 * silence says "keep the last one".
 *
 * **And a boundary with no blend is stamped {@link HARD_JOIN_MS}, never zero.**
 * `blendFor` answers in the station's terms, where zero means no overlap; this
 * is where that becomes something the engine can be told, and the two are not
 * the same number. See {@link HARD_JOIN_MS} for what a zero actually does.
 */
function crossAnnotations(item: RundownItem, context: AnnotationContext): Record<string, string> {
    const out = blendFor(item, context.next, context);
    const into = context.previousBlendMs ?? 0;

    return {
        liq_cross_end_duration: seconds(out === 0 ? HARD_JOIN_MS : out),
        liq_cross_start_duration: seconds(into === 0 ? HARD_JOIN_MS : into),
    };
}

/**
 * The blend out of this item, for a caller that has to carry it to the next one.
 *
 * Exported so the pusher stamps ONE number on both ends of a boundary rather
 * than computing it twice from two different vantage points and hoping they
 * agree. They would not: by the time the incoming item is handed over, the
 * running order may have moved.
 */
export function blendOutOf(item: RundownItem, context: AnnotationContext): number {
    return blendFor(item, context.next, context);
}

/**
 * Wrap a uri in `annotate:key="value",...:uri`.
 *
 * Values are quoted, so a stream URL's own colons and query string pass through
 * untouched; quotes and backslashes inside a value are escaped.
 */
export function annotateUri(metadata: Record<string, string>, uri: string): string {
    const pairs = Object.entries(metadata).map(([key, value]) => `${key}="${value.replace(/(["\\])/g, '\\$1')}"`);
    return pairs.length === 0 ? uri : `annotate:${pairs.join(',')}:${uri}`;
}
