import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import { DataRepository } from '#modules/data/data.repository.js';
import { toJsonb } from '#modules/data/jsonb.js';
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
            .select([
                'broadcastId',
                'name',
                'brief',
                'eraFrom',
                'eraTo',
                'personaId',
                'slotId',
                'placedBy',
                'holdUntil',
                'mode',
                'onEnd',
                'source',
                'sourcePluginId',
                'sourcePlaylistId',
                'sourceChartId',
                'items',
                'rules',
            ])
            .where('stationKey', '=', stationKey)
            .executeTakeFirst();
        if (!row) return undefined;

        return new StationLineup(
            {
                // Read back rather than left to the constructor's mint, which is what makes a
                // restart resume the broadcast that was already running instead of starting a
                // second one halfway through it.
                broadcastId: row.broadcastId,
                name: row.name,
                // Empty reads as absent rather than as an empty instruction, so the column's
                // default and a station that was never briefed are the same thing everywhere above.
                ...(row.brief ? { brief: row.brief } : {}),
                // Null at either end is no bound, and the two are independent: a broadcast may be
                // "1990 onwards" with nothing said about the other end.
                ...(row.eraFrom == null ? {} : { eraFrom: row.eraFrom }),
                ...(row.eraTo == null ? {} : { eraTo: row.eraTo }),
                // Null means the station's own active persona, so an absent host and a station that
                // was never told who is presenting are the same thing everywhere above.
                ...(row.personaId == null ? {} : { personaId: row.personaId }),
                // Which slot of the day this belongs to. Read back so a restart mid-programme knows
                // whether it is still airing what the schedule wants, rather than changing over
                // once on every boot.
                ...(row.slotId == null ? {} : { slotId: row.slotId }),
                // Who put it on. The column is `not null default 'operator'`, so this is only ever
                // narrowing text to the union; anything unexpected reads as the operator, which is
                // the safer of the two to be wrong about — it says a takeover is in force rather
                // than telling somebody the clock is driving when it is not.
                placedBy: row.placedBy === 'schedule' ? 'schedule' : 'operator',
                // Epoch millis on the way out, because the binding is stored and sent and the
                // JSON-safe rule allows no `Date` across either boundary.
                ...(holdMillis(row.holdUntil) === undefined ? {} : { holdUntil: holdMillis(row.holdUntil)! }),
                mode: row.mode as StationLineupMode,
                onEnd: row.onEnd as StationLineupOnEnd,
                source: row.source,
                ...(row.sourcePluginId == null ? {} : { sourcePluginId: row.sourcePluginId }),
                ...(row.sourcePlaylistId == null ? {} : { sourcePlaylistId: row.sourcePlaylistId }),
                ...(row.sourceChartId == null ? {} : { sourceChartId: row.sourceChartId }),
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
            // Written on every save rather than only on the first, because `putOnAir` replacing the
            // running order is a NEW broadcast in the same row: the upsert below updates, so a
            // broadcast id left out of the update set would leave the previous one in place and
            // every row stamped after it would name a broadcast that is no longer on.
            broadcastId: snapshot.broadcastId,
            name: snapshot.name,
            brief: snapshot.brief ?? '',
            eraFrom: snapshot.eraFrom ?? null,
            eraTo: snapshot.eraTo ?? null,
            personaId: snapshot.personaId ?? null,
            slotId: snapshot.slotId ?? null,
            placedBy: snapshot.placedBy ?? 'operator',
            // Through SQL rather than as a value, exactly as `break.request.repository.ts` does it:
            // Postgres is handed a number and converts it itself, so the `DateTime`-versus-`Date`
            // mismatch in the generated types never has to be resolved here. `Infinity` is the one
            // value `to_timestamp` cannot take, and it is the whole point of the column — it is the
            // "until I release it" hold — so it goes as the literal Postgres understands.
            holdUntil: snapshot.holdUntil === undefined ? null : snapshot.holdUntil === Infinity ? sql<never>`'infinity'::timestamptz` : instant(snapshot.holdUntil),
            mode: snapshot.mode,
            onEnd: snapshot.onEnd,
            source: snapshot.source,
            sourcePluginId: snapshot.sourcePluginId ?? null,
            sourcePlaylistId: snapshot.sourcePlaylistId ?? null,
            sourceChartId: snapshot.sourceChartId ?? null,
            rules: toJsonb(snapshot.rules),
            items: toJsonb(snapshot.items),
        };

        await this.db
            .insertInto('deadair.stationLineup')
            .values({ stationKey, ...values })
            .onConflict(oc => oc.column('stationKey').doUpdateSet(values))
            .execute();
    }

    /**
     * The catalog ids of the records still ahead of the cursor, nearest slot first.
     *
     * What anything walking the catalog reads to find out what the station is ABOUT to play, as
     * opposed to what it holds. The enrichment walk is the first caller: a record described after it
     * aired was described for nothing, and this is the list that says which ones are worth a
     * rate-limited request now.
     *
     * It lives here rather than being read by that walk directly, because the shape of
     * `station_lineup.items` is the director's and nothing outside this file should know that a
     * running order is jsonb. What crosses the boundary is a list of ids.
     *
     * Read in SQL rather than through {@link load}, which would build a whole {@link StationLineup}
     * and its every item to answer a question about one field. The trade is that the state names
     * appear twice, here and in {@link STATES} — worth it for a read that runs on a schedule, and the
     * two disagreeing costs at worst a record enriched a few minutes later than it might have been.
     *
     * Three things it deliberately drops. Anything already behind the cursor (`played`, `skipped`,
     * `unavailable`) or cut before its turn (`removed`), because no writer will ever be asked about
     * those again. Segments, which are the station's own words and have nothing to look up. And any
     * item with no `trackId` at all, which is the ordinary state of a record the catalog has never
     * seen — there is nothing to enrich until something ingests it.
     *
     * Deduplicated in slot order, since the same record legitimately sits at two positions in an hour
     * and the earlier one is the one the deadline belongs to.
     */
    async lineupTrackIds(stationKey = MAIN_STATION): Promise<string[]> {
        // `with ordinality` is the whole reason this is not a `select distinct`: the ORDER is the
        // answer's value. A caller ranking by position gets "enrich the record that airs soonest
        // first" for free, and a set would have thrown that away.
        //
        // Keys come back camelCased even from raw SQL — `CamelCasePlugin` is in
        // `KyselyDefaultPlugins` and rewrites result keys either way.
        const rows = await sql<{ trackId: string }>`
            select line.item -> 'track' ->> 'trackId' as track_id
              from deadair.station_lineup,
                   lateral jsonb_array_elements(items) with ordinality as line(item, position)
             where station_key = ${stationKey}
               and line.item ->> 'kind' = 'track'
               and line.item -> 'track' ->> 'trackId' is not null
               -- An unrecognised state reads as still to come, matching toItems below: the two ways
               -- of being wrong are not symmetrical, and an extra lookup is cheaper than a record
               -- that airs with nothing to say about it.
               and coalesce(line.item ->> 'state', 'planned') not in ('played', 'skipped', 'unavailable', 'removed')
             order by line.position
        `.execute(this.db);

        return [...new Set(rows.rows.map(row => row.trackId))];
    }

    /** Forget the running order entirely. What a station taken out of service leaves behind. */
    async remove(stationKey = MAIN_STATION): Promise<void> {
        await this.db.deleteFrom('deadair.stationLineup').where('stationKey', '=', stationKey).execute();
    }
}

/** The states an item may legally come back in. Anything else is a row nobody here wrote. */
const STATES = new Set<string>(['planned', 'handed', 'airing', 'played', 'skipped', 'unavailable', 'removed']);

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
            | {
                  id?: unknown;
                  kind?: unknown;
                  state?: unknown;
                  segmentId?: unknown;
                  segmentKind?: unknown;
                  groupId?: unknown;
                  over?: { atMs?: unknown };
                  track?: Partial<RundownTrack>;
              }
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
            // Both optional fields come back, or a restart changes what the row means. `save`
            // writes the item whole, and for a long time this read it back without `segmentKind`
            // or `groupId`: after every resume a planted bulletin was an unlabelled station break
            // (so an anchored news band replanted a second one beside it and the spacing walk
            // counted it against the wrong kind), and a production's beats were no longer a block
            // (so an unheard episode was never handed back at a changeover, and removing one beat
            // left the rest to air around the hole). The round-trip test beside this file is
            // what keeps the two halves of the serializer the same shape.
            items.push({
                id: line.id,
                kind: 'segment',
                state,
                segmentId: line.segmentId,
                ...(typeof line.segmentKind === 'string' ? { segmentKind: line.segmentKind } : {}),
                ...(atMs === undefined ? {} : { over: { atMs } }),
                ...(typeof line.groupId === 'string' ? { groupId: line.groupId } : {}),
            });
            return items;
        }

        if (typeof line.track?.externalId === 'string' && typeof line.track.pluginId === 'string') {
            // The lead artist, filled in where the row predates the field. A restart mid-broadcast
            // reads an order this process did not write, and `artist` is the one field every
            // reader takes at face value — an item without it would reach `normalizeKey` as
            // `undefined` and throw on the air path. `artists[0]` is the best available answer and
            // is exactly what the old items meant by it.
            const track =
                typeof line.track.artist === 'string'
                    ? (line.track as RundownTrack)
                    : ({ ...line.track, artist: line.track.artists?.[0] ?? '' } as RundownTrack);
            items.push({ id: line.id, kind: 'track', state, track });
        }
        return items;
    }, []);
};

export type { StationLineupBinding, StationLineupSnapshot };

/**
 * A hold as epoch millis, or `undefined` for a row with none.
 *
 * Three shapes, and the third is why this is a function. An ordinary timestamptz comes back from the
 * driver as a `Date`; the generated types call it a luxon `DateTime`, which is the mismatch
 * `break.request.repository.ts` already handles the same way; and `infinity` comes back as the NUMBER
 * `Infinity`, which is neither. That last one is verified against the driver rather than assumed, and
 * it is exactly the hold that never expires.
 */
function holdMillis(value: unknown): number | undefined {
    if (value == null) return undefined;
    if (typeof value === 'number') return value;
    if (value instanceof Date) return value.getTime();

    return typeof (value as { toMillis?: () => number }).toMillis === 'function' ? (value as { toMillis: () => number }).toMillis() : undefined;
}

/**
 * Epoch millis as something the column will take.
 *
 * Through SQL rather than as a value, exactly as `break.request.repository.ts` does it and for the
 * same reason: Postgres is handed a number and does the conversion itself, so the
 * `DateTime`-versus-`Date` mismatch in the generated types never has to be resolved here.
 */
const instant = (millis: number) => sql<never>`to_timestamp(${millis} / 1000.0)`;
