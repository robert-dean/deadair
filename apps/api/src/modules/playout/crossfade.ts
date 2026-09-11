/**
 * How long one record overlaps the next, decided before either airs.
 *
 * **A blend is a property of the PAIR, not of a record and not of a setting.**
 * That is the whole design, and it is what makes this measurable rather than
 * tunable: a record that ends cold has a short outro and is barely ridden, one
 * that fades has a long one and is ridden for as long as the next record's intro
 * can absorb it, never longer. So a blend can never eat a cold opening, and there
 * is no number for an operator to get wrong.
 *
 *     buffer = min(outgoing.outro, incoming.intro)
 *
 * Both lengths come off the four cue points in `deadair.track_analysis`, carried
 * on the item by `pick.resolver.ts`. See [crossfades](https://github.com/robert-dean/deadair/discussions/11), "Where the
 * length comes from".
 *
 * Kept pure and unit-tested for the same reason `gain.ts` beside it is: what this
 * returns rides an annotation into a player that will not complain about it. A
 * wrong number here is not an error anybody sees, it is a boundary that sounds
 * wrong.
 *
 * **Zero is the answer, not a failure.** Every refusal below degrades to a hard
 * join, which is what the station did before any of this existed, so an
 * unmeasured track costs one cold boundary rather than anything audible going
 * wrong.
 */

/**
 * The four points as this file needs them, which is the narrow shape `gain.ts`
 * takes for the same reason: a `RundownItem` satisfies it structurally, and a
 * test does not have to build one to ask a question about two numbers.
 */
export interface MeasuredCuePoints {
    cueInMs?: number;
    introEndMs?: number;
    outroStartMs?: number;
    cueOutMs?: number;
}

/**
 * The shortest overlap worth having.
 *
 * Below this a blend is not a shorter blend, it is a buffer spent on something
 * nobody can hear as one, and it is not free: `cross` holds the whole duration,
 * and that buffer is what puts the voice-cue clock ahead of the
 * audience. A record whose measured outro is a fifth of a second ended cold, and
 * a cold ending against a cold opening is a hard join by intent.
 */
export const MIN_BLEND_MS = 500;

/**
 * The longest, from [crossfades](https://github.com/robert-dean/deadair/discussions/11).
 *
 * The measurement has to authorise every millisecond of this. Twelve seconds
 * means the outgoing record has twelve seconds of outro AND the incoming has
 * twelve seconds of intro, which is a genuinely instrumental opening against a
 * genuinely long ending. The ceiling is here for the pair that measures longer
 * than that, where the honest description of the overlap stops being a segue and
 * becomes a mix.
 */
export const MAX_BLEND_MS = 12_000;

/** What the boundary depends on beyond the two records. */
export interface BlendRules {
    /**
     * Whether this broadcast blends at all.
     *
     * Resolved from the running order's mode and its own overrides; see
     * `resolveRules`. An album is the case this exists for: its gaps are a
     * decision somebody made and overlapping them overrules it.
     */
    crossfade: boolean;
}

/**
 * The overlap between one item and the one that follows it, in milliseconds.
 *
 * Zero for a boundary the station should not blend, which is every one of:
 *
 *   - the broadcast does not blend (an album, a sequenced setlist)
 *   - nothing follows this item, at the tail of the running order
 *   - either side is unmeasured, which includes every segment
 *   - the pair measures shorter than {@link MIN_BLEND_MS}
 *
 * `incoming` is what the running order says comes next at the moment this item is
 * handed over, which is not quite a promise: the successor can still turn out to
 * be unresolvable and be skipped, in which case the boundary blends by a length
 * computed for a record nobody heard. One slightly wrong overlap, and the
 * alternative is holding the stamp until the successor is certain, which is never:
 * by then this item has already been pushed.
 *
 * The successor can also change AFTER hand-over in the other direction: a break
 * injected at `committedThrough` lands behind a record whose blend was already
 * stamped off whatever WAS next at commit time, and that stamp is never revisited.
 * This function has no way to refuse that pairing, because at the time it runs the
 * break does not exist yet. `playout_transition` in `stream/radio.liq` is the
 * backstop: the mixer itself refuses to fade a record into speech, whatever this
 * returned, so a stamped blend that turns out to precede a break plays as a plain
 * sequence instead.
 */
export function blendFor(outgoing: MeasuredCuePoints, incoming: MeasuredCuePoints | undefined, { crossfade }: BlendRules): number {
    if (!crossfade || incoming === undefined) return 0;

    const outro = outroOf(outgoing);
    const intro = introOf(incoming);
    if (outro === undefined || intro === undefined) return 0;

    const buffer = Math.min(outro, intro);
    if (buffer < MIN_BLEND_MS) return 0;

    return Math.min(buffer, MAX_BLEND_MS);
}

/**
 * How long this record spends ending, or nothing.
 *
 * Derived rather than stored, here and in the measurement both: a stored
 * derivation is a second thing that can disagree with the first. The item
 * carries all four points or none, so one absent field means an unmeasured
 * track. Each is checked anyway, because these are read off a jsonb blob
 * two layers up and a type is not a guarantee about a row.
 */
function outroOf(item: MeasuredCuePoints): number | undefined {
    const { outroStartMs, cueOutMs } = item;
    if (outroStartMs === undefined || cueOutMs === undefined) return undefined;

    return Math.max(0, cueOutMs - outroStartMs);
}

/** How long this record spends getting underway, or nothing. */
function introOf(item: MeasuredCuePoints): number | undefined {
    const { cueInMs, introEndMs } = item;
    if (cueInMs === undefined || introEndMs === undefined) return undefined;

    return Math.max(0, introEndMs - cueInMs);
}
