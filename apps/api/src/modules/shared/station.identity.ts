import { Injectable } from 'injectkit';

/**
 * Which station, and which broadcast, the rows being written right now belong to.
 *
 * ## Why it is a singleton rather than an argument
 *
 * Four tables carry `station_key` and `broadcast_id` — `play_history`, `segment_events`,
 * `script_history`, `station_events` — and they are written from four different modules, most of
 * them from jobs and timer loops with no request scope and no path back to the director. Threading
 * the two values down as parameters would put them in every signature between the top and the
 * insert, including several that have no other reason to know what a broadcast is.
 *
 * It lives in `shared/` for the reason `Heartbeat` and `Epoch` do: `render`, `catalog` and
 * `activity` are all registered BEFORE `director` in `modules.ts`, so a holder any of them imported
 * from the director would invert the module edge. Nothing here imports anything.
 *
 * ## What it holds, and what it deliberately does not
 *
 * The station key is a constant with one value today, and the column exists so the second is a row
 * rather than a migration. The broadcast is live state, written by the ONE thing that starts and
 * ends broadcasts, and read by everyone else.
 *
 * **It is not a fallback for `undefined`.** A writer outside a broadcast — a library scan, a plugin
 * reload, an operator's setting change — gets `undefined` and must store null rather than reaching
 * for the last broadcast that happened to be on. Stamping those rows with a broadcast they had
 * nothing to do with would make the column lie in exactly the place a reader would trust it: a
 * query for what happened during a show would come back carrying things that happened between two.
 */
@Injectable()
export class StationIdentity {
    /**
     * The station these rows belong to.
     *
     * One value today, matching `station_lineup.station_key` and `station_air.slot`. It is a
     * property rather than a bare exported constant so the day a second station exists, the thing
     * to change is what is registered here rather than every call site that spelled `'main'`.
     */
    readonly stationKey = 'main';

    private broadcast?: string;

    /** Which broadcast is on, or `undefined` when the station is not airing one. */
    current(): string | undefined {
        return this.broadcast;
    }

    /**
     * A broadcast has started, or the app has read back the one that was already running.
     *
     * Idempotent by value: setting the same id twice is a restart resuming, not a second broadcast.
     */
    began(broadcastId: string): void {
        this.broadcast = broadcastId;
    }

    /**
     * The station is no longer airing a broadcast: a stand-down, or a shutdown.
     *
     * Called so that anything written afterwards is honestly unattributed rather than filed under a
     * programme that has already ended.
     */
    ended(): void {
        this.broadcast = undefined;
    }
}
