import { Injectable } from 'injectkit';

/**
 * What the schedule has already said, so it does not say it again every minute.
 *
 * The tick runs sixty times an hour and its failures are STICKY: a slot whose playlist has emptied
 * will refuse to air on every run until somebody fixes it, and a gap with no sustaining source is a
 * standing state rather than a moment. Recording either on each pass would turn the activity feed
 * into a log file with a primary key, which is the failure `ActivityRecorder` documents at length and
 * the reason every producer on that feed writes on EDGES.
 *
 * The tick cannot spot its own edges, because nothing it can read distinguishes the first failure
 * from the hundredth — the mismatch that caused it is still there. So the edge lives here.
 *
 * ## In memory, and that is a decision rather than a shortcut
 *
 * This holds "may I say that again", a question with no value past the current process: what actually
 * happened is already durable in `station_events`, and a restart costing one repeated line is cheaper
 * than a table and a sweep for it. Exactly the call `ReadLog` makes for a bulletin's stories, and for
 * the same reason — memory is the authority, and the row is the record.
 *
 * A singleton, because the job is transient and rebuilt on every run.
 */
@Injectable()
export class ScheduleNotices {
    private lastSaid?: string;

    /**
     * Whether this is worth saying, which it is when it is not what was said last.
     *
     * Keyed on the whole claim rather than on a kind, so a station that fails over one slot and then
     * a different one reports both: the second is new information, where the same slot failing again
     * is not.
     */
    shouldSay(notice: string): boolean {
        if (this.lastSaid === notice) return false;

        this.lastSaid = notice;
        return true;
    }

    /**
     * Something worked, so the next failure is news again.
     *
     * Called on every successful pass rather than only after a failure: a schedule that recovered and
     * broke again in the same way is two events, and an operator reading the feed has no way to know
     * the second one happened otherwise.
     */
    settled(): void {
        this.lastSaid = undefined;
    }
}
