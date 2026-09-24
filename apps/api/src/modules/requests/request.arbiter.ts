/**
 * Whether a request may be taken, decided from facts the caller has already read.
 *
 * Pure, and separate from everything that reads, because this is the part of requests that is a
 * policy rather than plumbing: Ideas #76 says the real design problem is arbitration, not intake.
 * One open request per person, a cooldown after one is let through, and a cap on how many are open
 * at once, so the night does not become a jukebox with a voice-over. Each refusal is a sentence the
 * station can say to the person asking.
 */

/** What the arbitration needs to know. */
export interface RequestFacts {
    enabled: boolean;
    onAir: boolean;
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

export function arbitrate(facts: RequestFacts): RequestDecision {
    if (!facts.enabled) return { ok: false, reason: 'The station is not taking requests right now.' };
    if (!facts.onAir) return { ok: false, reason: 'The station is off the air, so it is not taking requests.' };
    if (facts.openForRequester !== undefined) {
        return { ok: false, reason: `You already have a request in: ${facts.openForRequester}. One at a time.` };
    }
    if (facts.lastGrantedAt !== undefined && facts.cooldownMs > 0) {
        const wait = facts.lastGrantedAt + facts.cooldownMs - facts.now;
        if (wait > 0) return { ok: false, reason: `One request every ${minutesLeft(facts.cooldownMs)}, so try again in ${minutesLeft(wait)}.` };
    }
    if (facts.trackAlreadyOpen) return { ok: false, reason: 'Somebody has already asked for that one, so it is on its way.' };
    if (facts.openCount >= facts.maxOpen) return { ok: false, reason: 'The request line is full. Try again after the next few records.' };
    return { ok: true };
}
