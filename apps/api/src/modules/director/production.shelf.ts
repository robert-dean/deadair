import type { Production } from '#modules/productions/production.js';

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
 */
export function standingCall(production: Pick<Production, 'kind' | 'scheduledFor' | 'actorId'>, dialogueKinds: ReadonlySet<string>): boolean {
    return production.scheduledFor === undefined && production.actorId === undefined && dialogueKinds.has(production.kind.trim().toLowerCase());
}
