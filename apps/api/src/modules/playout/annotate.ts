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

import { blendFor } from './crossfade.js';
import { gainFor } from './gain.js';
import type { RundownItem } from './rundown.js';

/** The metadata key carrying the rundown item id. Must match `radio.liq`. */
export const ITEM_KEY = 'deadair_item';

/** What an item's annotations depend on beyond the item itself. */
export interface AnnotationContext {
    /** Where the station wants its records to sit, in LUFS. See `gain.ts`. */
    targetLufs: number;
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
}

/**
 * The annotations one item goes to the player with.
 *
 * `title`, `artist` and `album` are Liquidsoap's own metadata names, not ours:
 * `output.icecast` builds the ICY stream title out of what the source is
 * playing, so setting them here is what puts the track in a listener's player.
 * That is also why this is the labelling path rather than Icecast's admin API —
 * the label travels with the item, so it changes on the boundary itself and
 * needs no second credential to push it.
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
function gainAnnotations(item: RundownItem, { targetLufs }: AnnotationContext): Record<string, string> {
    const gainDb = gainFor(item, targetLufs);

    return gainDb === undefined ? {} : { liq_amplify: `${gainDb} dB` };
}

/**
 * `liq_cross_duration`: how long this record overlaps the one after it.
 *
 * Liquidsoap's own name, in seconds, and like the keys above **it does nothing
 * without the operator in the graph to read it**, meaning a `cross` in
 * `radio.liq`. Stamped on the OUTGOING item because that is where `cross` reads it: the
 * override sizes the ending track's own end-of-track buffer. Its VALUE is
 * decided by the pair, which is why {@link AnnotationContext} has to carry the
 * successor.
 *
 * **Always stamped, including a zero**, which is the one line here that looks
 * defensive and is load-bearing. `cross` needs `persist_override=true` on 2.4 or
 * the override is reset before it sizes anything, and the flip side of persist
 * is that a stamp LINGERS over every later unstamped track. So an item without
 * one would not be a hard join, it would be a blend by whatever number the last
 * measured record happened to leave behind.
 *
 * That makes this the opposite call from `liq_cue_in` above, which is omitted at
 * zero. There the default is the same as the value and silence says it; here
 * silence says "keep the last one".
 */
function crossAnnotations(item: RundownItem, context: AnnotationContext): Record<string, string> {
    return { liq_cross_duration: seconds(blendFor(item, context.next, context)) };
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
