/**
 * Whether a request may be taken, decided from facts the caller has already read.
 *
 * Pure, and separate from everything that reads, because this is the part of requests that is a
 * policy rather than plumbing: Ideas #76 says the real design problem is arbitration, not intake.
 * One open request per person, a cooldown after one is let through, and a cap on how many are open
 * at once, so the night does not become a jukebox with a voice-over. Each refusal is a sentence the
 * station can say to the person asking.
 *
 * Those three are about listeners, so an operator is held to none of them: the night is theirs to
 * shape, and the rules that keep listeners from shaping too much of it have nothing to say to them.
 * Requests on, the station on the air and one open request per record still hold for them.
 */

/** What the arbitration needs to know. */
export interface RequestFacts {
    enabled: boolean;
    onAir: boolean;
    /** Whether the person asking runs the station, which lifts one at a time, the cooldown and the cap. */
    operator?: boolean;
    /** The title of this person's request that is still open, if they have one. */
    openForRequester?: string;
    /** Epoch millis of this person's last request that was let through. */
    lastGrantedAt?: number;
    cooldownMs: number;
    /** Whether somebody already has this very record open. */
    trackAlreadyOpen: boolean;
    openCount: number;
    maxOpen: number;
    now: number;
}

export type RequestDecision = { ok: true } | { ok: false; reason: string };

/** The minutes left on a cooldown, as a person would say it. */
const minutesLeft = (ms: number): string => {
    const minutes = Math.max(1, Math.ceil(ms / 60_000));
    return minutes === 1 ? 'a minute' : `${minutes} minutes`;
};

/**
 * The refusal for somebody who already has a request open, naming it when it is known. Exported
 * because the database gives the same answer when two of one person's requests arrive together: see
 * `OpenRequestTaken`.
 */
export const oneAtATime = (open?: string): string =>
    open === undefined ? 'You already have a request in. One at a time.' : `You already have a request in: ${open}. One at a time.`;

/** The refusal for a record somebody already has open. Exported for the same reason as {@link oneAtATime}. */
export const TRACK_ALREADY_OPEN = 'Somebody has already asked for that one, so it is on its way.';

/** What the arbitration needs to know about the person asking, before anybody knows which record it is. */
export type RequesterFacts = Omit<RequestFacts, 'trackAlreadyOpen'>;

/**
 * Every rule that is about the person asking and the line rather than the record: requests on, the
 * station on the air, one at a time, the cooldown and the cap, the last three lifted for an operator. Run before a record from a provider is
 * taken in, so somebody who would be refused anyway does not add a record to the library first.
 */
export function arbitrateRequester(facts: RequesterFacts): RequestDecision {
    if (!facts.enabled) return { ok: false, reason: 'The station is not taking requests right now.' };
    if (!facts.onAir) return { ok: false, reason: 'The station is off the air, so it is not taking requests.' };
    if (facts.operator === true) return { ok: true };
    if (facts.openForRequester !== undefined) return { ok: false, reason: oneAtATime(facts.openForRequester) };
    if (facts.lastGrantedAt !== undefined && facts.cooldownMs > 0) {
        const wait = facts.lastGrantedAt + facts.cooldownMs - facts.now;
        if (wait > 0) return { ok: false, reason: `One request every ${minutesLeft(facts.cooldownMs)}, so try again in ${minutesLeft(wait)}.` };
    }
    if (facts.openCount >= facts.maxOpen) return { ok: false, reason: 'The request line is full. Try again after the next few records.' };
    return { ok: true };
}

/** The whole arbitration: the person and the line first, then the one rule that needs the record. */
export function arbitrate(facts: RequestFacts): RequestDecision {
    const requester = arbitrateRequester(facts);
    if (!requester.ok) return requester;
    if (facts.trackAlreadyOpen) return { ok: false, reason: TRACK_ALREADY_OPEN };
    return { ok: true };
}
