/**
 * Choosing a batch of records for a running order: the slow half, in one place.
 *
 * Shared by the two jobs that programme a rotation, which want exactly the same work and differ
 * only in what they do with the answer: `ExtendLineupJob` puts it on the end and
 * `ReplanLineupJob` puts it where the tail used to be. Neither of them writes the running order —
 * both post a command — so what belongs here is everything between "the order says this" and "here
 * are the records", and nothing either side of that.
 */

import type { Persona } from '#modules/personas/persona.js';
import type { RundownTrack } from '#modules/playout/rundown.js';
import type { PickResolver } from './pick.resolver.js';
import { songKey } from './rotation.keys.js';
import type { ResolvedRules } from './rotation.rules.js';
import type { SetGenerator } from './set.generator.js';
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
    /** Who is presenting, resolved by the caller. Absent is ordinary and means nobody chose. */
    persona?: Persona;
    /** Songs not to choose again: what the order already holds, or what it is about to stop holding. */
    avoidSongKeys: ReadonlySet<string>;
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
 * Name a batch of records and turn them into ones the station can actually play.
 *
 * The rules go WITH the picks. `PickResolver` judges every one of them against these, whatever
 * generator named them, which is what stops a second binding routing around a dislike.
 */
export const planRecords = async (generator: SetGenerator, resolver: PickResolver, request: PlanRequest): Promise<PlannedRecords> => {
    const picks = await generator.generate({
        count: Math.ceil(request.count * OVERSAMPLE),
        rules: request.rules,
        ...(request.brief ? { brief: request.brief } : {}),
        ...(request.persona === undefined ? {} : { persona: request.persona }),
        avoidSongKeys: request.avoidSongKeys,
    });

    const resolved = await resolver.resolve(picks, request.rules);

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
    new Set(items.filter(isTrackItem).map(item => songKey(item.track.title, item.track.artists)));
