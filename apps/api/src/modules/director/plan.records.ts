/**
 * Choosing a batch of records for a running order: the slow half, in one place.
 *
 * Shared by the two jobs that programme a rotation, which want exactly the same work and differ
 * only in what they do with the answer: `ExtendLineupJob` puts it on the end and
 * `ReplanLineupJob` puts it where the tail used to be. Neither of them writes the running order —
 * both post a command — so what belongs here is everything between "the order says this" and "here
 * are the records", and nothing either side of that.
 */

import type { RundownTrack } from '#modules/playout/rundown.js';
import type { PickResolver } from './pick.resolver.js';
import { artistKey, songKey } from './rotation.keys.js';
import type { ResolvedRules } from './rotation.rules.js';
import type { SetGenerator, TrackPick } from './set.generator.js';
import { isTrackItem, type StationLineupItem } from './station.lineup.js';

/** How many tracks a batch holds when nobody says. Roughly an hour of programming. */
export const DEFAULT_COUNT = 15;

/**
 * Ask for more names than the lineup needs.
 *
 * Between the repeat window, the artist cooldown, the per-artist cap and picks
 * that resolve to nothing, a meaningful share of any batch is discarded. Without
 * the headroom the lineup comes back short, runs dry sooner, and the director
 * simply asks again — which costs another sample and another pass over the
 * history for the same reason it did the first time.
 */
const OVERSAMPLE = 1.6;

/** What a caller knows about the order it is programming for. */
export interface PlanRequest {
    /** How many records are wanted. What comes back is capped at this, never padded up to it. */
    count: number;
    rules: ResolvedRules;
    /** What the operator asked for, read off the running order rather than carried in a payload. */
    brief?: string;
    /** The period it plays, read off the running order beside the brief and for the same reason. */
    era?: { from?: number; to?: number };
    /** Songs not to choose again: what the order already holds, or what it is about to stop holding. */
    avoidSongKeys: ReadonlySet<string>;
    /**
     * Artists not to choose, over a narrow window: who is at the tail of the order right now.
     *
     * Deliberately not the whole-order exclusion {@link avoidSongKeys}'s own doc argues against —
     * this is scoped by the caller to a `maxPerArtist + 1` window rather than to everything the
     * lineup holds, which is what keeps it out of the same starvation trap.
     */
    avoidArtistKeys?: ReadonlySet<string>;
    /**
     * The artist already at the tail of the order, so a refill's batch does not reopen with them.
     *
     * Not a candidate to avoid choosing — {@link avoidArtistKeys} is that — but the one thing
     * {@link spaceArtists} compares its first placement against.
     */
    seedArtistKey?: string;
}

/** The records, and enough of the arithmetic for a caller's log line to be worth reading. */
export interface PlannedRecords {
    tracks: RundownTrack[];
    /** How many the generators named, before the rules and the resolver had their say. */
    named: number;
    /** How many survived resolution, which is what the oversample is spent on. */
    resolved: number;
}

/**
 * How many times a batch is planned before its answer is kept, at most.
 *
 * Two: one ordinary attempt and one more if a break took the model off the first. Not a general
 * retry — a generator that failed, declined or found nothing is not tried again, because those are
 * answers and asking twice would produce the same one at twice the cost.
 *
 * The bound is what keeps a busy hour from starving a refill entirely. A station taking a break
 * every few records can preempt the retry too, and at that point the floor's hour is the honest
 * outcome: it is a station whose model is genuinely oversubscribed, and the fix for that is not
 * more attempts.
 */
const MAX_PLANNING_ATTEMPTS = 2;

/**
 * Name a batch of records and turn them into ones the station can actually play.
 *
 * The rules go WITH the picks. `PickResolver` judges every one of them against these, whatever
 * generator named them, which is what stops a second binding routing around a dislike.
 *
 * ## A preempted refill is planned again
 *
 * `ModelSetGenerator` runs as `background` so a break can take the model back mid-conversation, and
 * that is the design working — a break is a slot in a running order and a refill is not. But the
 * cost was being paid in the wrong place: the model was cut off, the chain topped the batch up from
 * the floor, and the operator got an hour of ordinary rotation with nothing left to say the brief
 * had ever been read. Measured on a `classic banjo` refill preempted 4.6 seconds in.
 *
 * Nobody is waiting on this, so the answer is simply to ask again. The retry needs no delay and no
 * second job: `LlmGate` queues it, the break ahead of it finishes in seconds, and if the gate times
 * out the chain absorbs it exactly as it absorbs every other way a generator can fail.
 *
 * **Planned again from scratch rather than topped up**, because the floor's picks were chosen to
 * fill a hole the model was going to fill properly, and keeping them would leave the batch shaped by
 * the interruption. **And resolution happens once, after the last attempt** — a discarded batch must
 * not spend `PickResolver`'s discovery budget or ingest records nothing will play.
 *
 * @param preemption - The scoped signal `ModelSetGenerator` marks. Absent means no retry, which is
 *   what a caller with no model binding in its chain wants.
 */
export const planRecords = async (
    generator: SetGenerator,
    resolver: PickResolver,
    request: PlanRequest,
    preemption?: { took(): boolean; onRetry?: (attempt: number) => void },
): Promise<PlannedRecords> => {
    let picks: TrackPick[] = [];

    for (let attempt = 1; attempt <= MAX_PLANNING_ATTEMPTS; attempt++) {
        picks = await generator.generate({
            count: Math.ceil(request.count * OVERSAMPLE),
            rules: request.rules,
            ...(request.brief ? { brief: request.brief } : {}),
            ...(request.era === undefined ? {} : { era: request.era }),
            avoidSongKeys: request.avoidSongKeys,
            ...(request.avoidArtistKeys === undefined ? {} : { avoidArtistKeys: request.avoidArtistKeys }),
        });

        // Asked AFTER every attempt and not only the retried one, because it clears as it answers:
        // leaving a mark standing would make the next refill in this scope read as preempted.
        const wasPreempted = preemption?.took() ?? false;
        if (!wasPreempted || attempt === MAX_PLANNING_ATTEMPTS) break;

        preemption?.onRetry?.(attempt);
    }

    const resolved = await resolver.resolve(picks, request.rules, {
        ...(request.era === undefined ? {} : { era: request.era }),
        ...(request.avoidArtistKeys === undefined ? {} : { avoidArtistKeys: request.avoidArtistKeys }),
        ...(request.seedArtistKey === undefined ? {} : { seedArtistKey: request.seedArtistKey }),
    });

    return {
        // Back down to what was asked for. The oversample is headroom against what the rules and
        // the resolver discard, not a licence to hand back half an hour more programming than the
        // station wanted.
        tracks: resolved.slice(0, request.count),
        named: picks.length,
        resolved: resolved.length,
    };
};

/**
 * The songs a running order holds, as keys the generator can avoid choosing again.
 *
 * Records only. The order's segments are not songs and have no artists, so feeding their labels
 * into the key space would have the generator avoiding a track it has never chosen.
 *
 * What the two callers mean by it differs, and both are right. A refill is saying "not these
 * again, they are already queued"; a replan is saying "not these again, I have just thrown them
 * out" — and that second one is what makes a replan produce a different hour rather than a
 * reshuffle with extra steps, since `play_history` only knows what actually aired.
 */
export const songKeysOf = (items: readonly StationLineupItem[]): Set<string> =>
    // `artist` and not `artists`: the same key `play_history` is written from, and the same one
    // `PickResolver` judges a pick by. These three have to agree byte for byte or the avoid list
    // silently stops matching anything credited to more than one act.
    new Set(items.filter(isTrackItem).map(item => songKey(item.track.title, [item.track.artist])));

/**
 * The artists a window of the running order holds, as keys a refill can be told not to open with.
 *
 * `artist`, the lead credit, for the same reason {@link songKeysOf} reads it rather than `artists`:
 * it is the key a cooldown, a cap and `play_history` all agree on. Callers pass a WINDOW here rather
 * than the whole order — see {@link PlanRequest.avoidArtistKeys} for why the whole order is the
 * wrong scope for an artist exclusion.
 */
export const artistKeysOf = (items: readonly StationLineupItem[]): Set<string> =>
    new Set(items.filter(isTrackItem).map(item => artistKey([item.track.artist])));
