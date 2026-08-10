import { Injectable } from 'injectkit';
import { DataRepository } from '#modules/data/data.repository.js';
import type { RundownTrack } from '#modules/playout/rundown.js';
import {
    StationLineup,
    type StationLineupBinding,
    type StationLineupItem,
    type StationLineupItemState,
    type StationLineupMode,
    type StationLineupOnEnd,
    type StationLineupRules,
    type StationLineupSnapshot,
} from './station.lineup.js';

/** The station whose running order this is. One today; the column exists so a second is a row. */
export const MAIN_STATION = 'main';

/**
 * Storage for `deadair.station_lineup`: the live running order, one row per
 * station.
 *
 * **The record, not the authority.** The owner holds the order in memory and
 * writes it here, so a station does not need Postgres up to advance a track. That
 * is the opposite way round from `LineupRepository`, which this takes over from:
 * there the row was the truth and every position change was a write.
 *
 * The whole document goes in one statement. There is no conditional write and no
 * revision to guard on, because there is exactly one writer — the director — and a
 * guard arbitrating writers that do not exist is how the last one grew two of them
 * without anybody noticing. Anything that wants to change what is airing posts a
 * command to the director instead.
 */
@Injectable()
export class StationLineupRepository extends DataRepository {
    /**
     * The station's running order, or `undefined` before it has ever been given
     * one.
     *
     * Absent is an ordinary state and not a failure: a station nobody has put
     * anything on air on has no row, which is exactly what it means.
     */
    async load(stationKey = MAIN_STATION): Promise<StationLineup | undefined> {
        const row = await this.db
            .selectFrom('deadair.stationLineup')
            .select(['name', 'mode', 'onEnd', 'source', 'sourcePluginId', 'sourcePlaylistId', 'items', 'rules'])
            .where('stationKey', '=', stationKey)
            .executeTakeFirst();
        if (!row) return undefined;

        return new StationLineup(
            {
                name: row.name,
                mode: row.mode as StationLineupMode,
                onEnd: row.onEnd as StationLineupOnEnd,
                source: row.source,
                ...(row.sourcePluginId == null ? {} : { sourcePluginId: row.sourcePluginId }),
                ...(row.sourcePlaylistId == null ? {} : { sourcePlaylistId: row.sourcePlaylistId }),
                ...(row.rules == null ? {} : { rules: row.rules as StationLineupRules }),
            },
            toItems(row.items),
        );
    }

    /**
     * Write the running order down.
     *
     * An upsert rather than an update, because the first broadcast on a station is
     * the row's first appearance and nothing seeds it: a station that has never
     * aired anything having no row is the honest state, not a missing row to be
     * repaired at boot.
     */
    async save(snapshot: StationLineupSnapshot, stationKey = MAIN_STATION): Promise<void> {
        const values = {
            name: snapshot.name,
            mode: snapshot.mode,
            onEnd: snapshot.onEnd,
            source: snapshot.source,
            sourcePluginId: snapshot.sourcePluginId ?? null,
            sourcePlaylistId: snapshot.sourcePlaylistId ?? null,
            rules: jsonb(snapshot.rules),
            items: jsonb(snapshot.items),
        };

        await this.db
            .insertInto('deadair.stationLineup')
            .values({ stationKey, ...values })
            .onConflict(oc => oc.column('stationKey').doUpdateSet(values))
            .execute();
    }

    /** Forget the running order entirely. What a station taken out of service leaves behind. */
    async remove(stationKey = MAIN_STATION): Promise<void> {
        await this.db.deleteFrom('deadair.stationLineup').where('stationKey', '=', stationKey).execute();
    }
}

/** Kysely wants a string for a jsonb column; the generated type says otherwise. */
const jsonb = (value: unknown): never | null => (value === undefined ? null : (JSON.stringify(value) as unknown as never));

/** The states an item may legally come back in. Anything else is a row nobody here wrote. */
const STATES = new Set<string>(['planned', 'handed', 'airing', 'played', 'skipped']);

/**
 * Read an order back out of jsonb.
 *
 * Defensive because this is the one place a hand-edited row, or a shape from an
 * older version of the app, reaches live code. An item that is not an item is
 * dropped rather than aired as `undefined`, which would fail to resolve and take
 * the station off air for the length of a record.
 *
 * **An unrecognised state reads as `planned` rather than being dropped.** The two
 * ways of being wrong are not symmetrical: a dropped item is programming lost in
 * silence, while one wrongly offered again is at worst a record played twice, which
 * is the same trade the whole write path is built on.
 */
const toItems = (value: unknown): StationLineupItem[] => {
    if (!Array.isArray(value)) return [];

    return value.reduce<StationLineupItem[]>((items, raw) => {
        // Described as the JSON it is rather than as a `Partial` of the union: intersecting the two
        // arms collapses their literal `kind`s to `never` and takes every other field with it.
        const line = raw as
            | { id?: unknown; kind?: unknown; state?: unknown; segmentId?: unknown; over?: { atMs?: unknown }; track?: Partial<RundownTrack> }
            | null
            | undefined;
        if (typeof line?.id !== 'string') return items;

        const state: StationLineupItemState =
            typeof line.state === 'string' && STATES.has(line.state) ? (line.state as StationLineupItemState) : 'planned';

        if (line.kind === 'segment') {
            if (typeof line.segmentId !== 'string') return items;
            // A malformed `over` reads as absent rather than as a cue at zero: a talk-over that
            // fires the instant a record starts is worse than one that plays in the gap, and a
            // hand-edited row should degrade to the simpler behaviour.
            const atMs = typeof line.over?.atMs === 'number' && line.over.atMs >= 0 ? line.over.atMs : undefined;
            items.push({ id: line.id, kind: 'segment', state, segmentId: line.segmentId, ...(atMs === undefined ? {} : { over: { atMs } }) });
            return items;
        }

        if (typeof line.track?.externalId === 'string' && typeof line.track.pluginId === 'string') {
            items.push({ id: line.id, kind: 'track', state, track: line.track as RundownTrack });
        }
        return items;
    }, []);
};

export type { StationLineupBinding, StationLineupSnapshot };
