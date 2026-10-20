import type { Production } from '#modules/productions/production.js';
import { BANTER_KIND, VISIT_KIND } from '#modules/productions/production.settings.js';
import { nextBoundaryAtOrAfter, projectAirTimes } from './air.clock.js';
import { landingFor, type AirClock } from './break.planner.js';
import type { StationLineupItem } from './station.lineup.js';

/**
 * How long a produced programme stays fit to air after it was made.
 *
 * A phone-in is written for the moment it was written in. Its host says "good morning" and "it's
 * 8:33", its callers talk about tonight, and none of that can be re-cut once it is audio. Nothing
 * aged one out, so a programme that missed its audience simply waited for the next one: on 24
 * September the station went on air at 07:24 with a phone-in made at 17:55 the evening before, and
 * the next one after it had been made at 02:02 and opened "Welcome folks to Callin Thursday evening".
 *
 * An hour, against what the station actually does: over the fortnight before this, every production
 * that went into the running order in the ordinary way did so between six and fourteen minutes after
 * it was commissioned, and the only two outside that were the five-hour waits this exists to stop.
 * So the bound sits well clear of a slow model and well short of a programme outliving its hour.
 */
export const PRODUCTION_SHELF_LIFE_MS = 60 * 60_000;

/**
 * Whether a production is too old to air.
 *
 * Measured from when it was made, or from when it was scheduled for if that is later, since a
 * programme commissioned ahead of its slot is written for the slot rather than for the moment it was
 * asked for.
 */
export function productionExpired(production: Pick<Production, 'createdAt' | 'scheduledFor'>, now: number): boolean {
    const madeFor = Math.max(production.createdAt, production.scheduledFor ?? 0);
    return now - madeFor >= PRODUCTION_SHELF_LIFE_MS;
}

/**
 * Whether a production is a call the standing rule commissioned, and so only fit to air in a
 * broadcast that takes calls.
 *
 * `ResolvedRules.callins` decides whether `ProductionScheduler` commissions one, and nothing decided
 * whether one was PLACED. A call takes minutes to make, so the broadcast that asked for it is often
 * not the one on air when it is ready: an operator who put a playlist on with no calls heard the
 * previous show's caller anyway.
 *
 * Only the standing kind is gated. A production with a slot is the format clock's, which is a time
 * rather than a property of the show, and one with an actor is somebody at the desk asking for this
 * call now. Both are instructions the broadcast's rule has no say over.
 *
 * A banter and a visit are dialogue kinds without being CALLS: nobody rings in, the presenters talk to
 * each other or to a guest, and whether a show has those is its co-hosts, not its call-ins. A standing
 * banter has no slot and no actor, so it used to answer `true` here, and on a co-hosted show that took
 * no calls every one was finished, skipped on every pass and retired an hour later: on 20 October not
 * one of them aired, and the one waiting to expire was what stopped the next being commissioned.
 */
export function standingCall(production: Pick<Production, 'kind' | 'scheduledFor' | 'actorId'>, dialogueKinds: ReadonlySet<string>): boolean {
    const kind = production.kind.trim().toLowerCase();
    if (kind === BANTER_KIND || kind === VISIT_KIND) return false;
    return production.scheduledFor === undefined && production.actorId === undefined && dialogueKinds.has(kind);
}

/**
 * Where a finished production goes in the order, or `undefined` while it has nowhere to go yet.
 *
 * One with no time airs at the first open boundary past what is committed, which is what every
 * production did. One with a time waits for it: it lands at the first open boundary at or after the
 * first boundary the projection puts at or after `scheduledFor`, and answers `undefined` while the
 * order does not reach that far, so the production stays `ready` and a later pass, against a longer
 * order, places it.
 *
 * The time used to be stored and never read, so a podcast asked for at eleven at night aired the
 * moment its last beat was joined, and a clock band's production commissioned three hours ahead aired
 * up to three hours early. The projection counts everything unmeasured as zero (`air.clock.ts`), so
 * the boundary it finds is at or after the time and never before it, which is the direction a
 * programme somebody asked for at a time can absorb.
 */
export function productionLanding(
    items: readonly StationLineupItem[],
    head: number,
    clock: Pick<AirClock, 'anchorAt' | 'from'>,
    scheduledFor: number | undefined,
): number | undefined {
    if (scheduledFor === undefined) return landingFor(items, head);

    const boundary = nextBoundaryAtOrAfter(projectAirTimes(items, clock.anchorAt, clock.from), scheduledFor, head);
    return boundary === undefined ? undefined : landingFor(items, boundary);
}
