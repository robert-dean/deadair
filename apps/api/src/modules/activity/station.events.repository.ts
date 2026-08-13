import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository } from '#modules/data/data.repository.js';
import { toJsonb } from '#modules/data/jsonb.js';

/**
 * The moments the station changed, when nothing else wrote them down: `deadair.station_events`.
 *
 * The activity feed reads three sources and this is the third. `segment_events` already holds a
 * break's journey and `play_history` already holds what aired, and neither is copied here — a fact
 * with two writers is two things that can disagree. What is left is everything that happens to the
 * station as a whole: a gate closing on it, an operator standing it down, the running order drying
 * up. See the migration for why that half needs storing at all when the silence diagnosis
 * deliberately stores nothing.
 *
 * ## Nothing here is load-bearing
 *
 * No caller reads a row to decide anything. Every write is best-effort at the call site, which is
 * what {@link ActivityRecorder} is for: an event write that fails must never cost the station the
 * thing it was describing. Same trade `segment_events` and `script_history` make, for the same
 * reason.
 */

/** Which part of the station is talking. The console's only filter axis. */
export type ActivityModule = 'playout' | 'director' | 'render' | 'catalog' | 'plugins';

/**
 * How an event reads, not how bad it is.
 *
 * There is deliberately no `waiting`, unlike `SilenceState`: a station idling for want of a listener
 * says so in its `detail` and stays `info`, because a feed that painted it amber would undo the
 * argument the `ready` badge exists on. Anything `fault` is something to go and fix.
 */
export type ActivitySeverity = 'info' | 'warn' | 'fault';

/** One thing that happened to the station. */
export interface StationEvent {
    module: ActivityModule;
    /** Dotted and stable: `silence.cause`, `air.on`, `air.off`, `starve`, `recover`. */
    kind: string;
    /** Defaults to `info`, which is what nearly everything is. */
    severity?: ActivitySeverity;
    /** The sentence a person reads, phrased by whoever already had to phrase it. */
    detail: string;
    /** The structured half, for a later reader that wants to filter or chart rather than read. */
    data?: Record<string, unknown>;
    /** Who did it. Absent for everything the station did to itself. */
    actorId?: string;
}

/** One event as it is read back. */
export interface StationEventEntry extends StationEvent {
    id: string;
    at: DateTime;
}

@Injectable()
export class StationEventsRepository extends DataRepository {
    /** Write one down. */
    async append(event: StationEvent): Promise<void> {
        await this.db
            .insertInto('deadair.stationEvents')
            .values({
                module: event.module,
                kind: event.kind,
                severity: event.severity ?? 'info',
                detail: event.detail,
                data: toJsonb(event.data),
                actorId: event.actorId ?? null,
            })
            .execute();
    }

    /**
     * Drop everything older than this many days. Answers how many rows went.
     *
     * `0` or less keeps everything, which is what the setting's own `0` means. Guarded HERE rather
     * than only at the call site, because this is the one statement in the module that deletes
     * anything and "keep it all" must not be reachable as "delete it all" by a caller that forgot.
     *
     * Compared against the database's own clock rather than the app's, exactly as
     * `ScriptHistoryRepository.pruneOlderThanDays` is, so an app whose host has drifted cannot
     * delete a week it should have kept.
     */
    async pruneOlderThanDays(days: number): Promise<number> {
        if (days <= 0) return 0;

        const result = await this.db
            .deleteFrom('deadair.stationEvents')
            .where('createdAt', '<', sql<DateTime>`now() - ${sql.lit(`${Math.floor(days)} days`)}::interval`)
            .executeTakeFirst();

        return Number(result.numDeletedRows ?? 0);
    }
}
