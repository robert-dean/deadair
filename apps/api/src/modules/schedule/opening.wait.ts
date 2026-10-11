import { Injectable } from 'injectkit';

/**
 * How long the tick holds a changeover while the incoming show's opening is chosen.
 *
 * A model refill took about two minutes on the live station for each of the three shows this was
 * written for (Neon Drive and Throwback Thursday on 2026-10-08, Saturday Requests on 2026-10-10), the
 * tick looks once a minute, and the prepare job fetches the first two records once it has chosen. Five
 * minutes covers that with a retry to spare and is still a short overrun of the show going off.
 */
export const OPENING_WAIT_MS = 5 * 60_000;

/**
 * When the tick started holding a changeover for an opening, so the hold is bounded.
 *
 * The tick is stateless on purpose and nothing else it can read says when a wait began: a slot added
 * at 11:55 that started at 10:00 has a start an hour and a half in the past. So the clock lives here,
 * in memory, on the argument {@link ScheduleNotices} makes: a restart costs one more wait of at most
 * {@link OPENING_WAIT_MS}, which is cheaper than a column and a sweep, and what happened is already
 * durable on the feed.
 *
 * Keyed on the slot AND the night, so a wait for tonight never counts against tomorrow's, and only
 * one wait at a time, because only one show can be next.
 *
 * A singleton, because the job is transient and rebuilt on every run.
 */
@Injectable()
export class OpeningWait {
    private waiting?: { key: string; since: number };

    /** How long this changeover has been held, starting the clock if it is the first time of asking. */
    heldFor(key: string, now: number): number {
        if (this.waiting?.key !== key) this.waiting = { key, since: now };
        return now - this.waiting.since;
    }

    /** The changeover happened, so the next wait starts from nothing. */
    clear(): void {
        this.waiting = undefined;
    }
}
