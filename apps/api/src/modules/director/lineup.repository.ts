import { Injectable } from 'injectkit';
import { DataRepository } from '#modules/data/data.repository.js';
import type { RundownTrack } from '#modules/playout/rundown.js';
import { Lineup, type LineupItem, type LineupMode, type LineupOnEnd, type LineupRules, type LineupSnapshot } from './lineup.js';

/** What a lineup looks like in a list, without dragging its whole order along. */
export interface LineupSummary {
    id: string;
    name: string;
    mode: LineupMode;
    onEnd: LineupOnEnd;
    source: string;
    sourcePluginId?: string;
    sourcePlaylistId?: string;
    revision: number;
    /** How many items it holds. Counted in SQL, so a list of twenty lineups is one query. */
    itemCount: number;
}

/** What creating a lineup needs. Everything else has a schema default. */
export interface NewLineup {
    name: string;
    mode?: LineupMode;
    onEnd?: LineupOnEnd;
    source?: string;
    sourcePluginId?: string;
    sourcePlaylistId?: string;
    rules?: LineupRules;
    tracks?: readonly RundownTrack[];
}

/**
 * Storage for `deadair.lineups`.
 *
 * The order is one jsonb document per row, which is what makes a reorder a
 * single write and an item a thing with no identity of its own outside the list
 * it belongs to. It also means this layer does no validation of the items
 * beyond their shape: {@link Lineup} owns what a legal order is.
 *
 * Nothing here knows about the cursor. That belongs to the broadcast rather than
 * the plan and lives in `deadair.station_air`; see `StationAirRepository`.
 */
@Injectable()
export class LineupRepository extends DataRepository {
    /** Every lineup, newest first, without their orders. */
    async list(): Promise<LineupSummary[]> {
        const rows = await this.db
            .selectFrom('deadair.lineups')
            .select(['id', 'name', 'mode', 'onEnd', 'source', 'sourcePluginId', 'sourcePlaylistId', 'revision'])
            // In SQL because the alternative is dragging every order across the wire to
            // call `.length` on it, and a rotation runs to hundreds of lines.
            .select(eb => eb.fn<number>('jsonb_array_length', ['items']).as('itemCount'))
            .orderBy('createdAt', 'desc')
            .execute();

        return rows.map(row => ({
            id: row.id,
            name: row.name,
            mode: row.mode,
            onEnd: row.onEnd,
            source: row.source,
            ...(row.sourcePluginId == null ? {} : { sourcePluginId: row.sourcePluginId }),
            ...(row.sourcePlaylistId == null ? {} : { sourcePlaylistId: row.sourcePlaylistId }),
            revision: row.revision,
            itemCount: Number(row.itemCount),
        }));
    }

    /**
     * One lineup as a live {@link Lineup}, with this repository bound as its
     * store, or `undefined` when the id is unknown.
     *
     * @param cursor - How far the broadcast has committed, for the lineup that is
     *   on air. Anything merely being read or edited is at zero, which is honest:
     *   nothing has been committed from it.
     */
    async load(id: string, cursor = 0): Promise<Lineup | undefined> {
        const row = await this.db
            .selectFrom('deadair.lineups')
            .select(['id', 'name', 'mode', 'onEnd', 'source', 'sourcePluginId', 'sourcePlaylistId', 'items', 'revision', 'rules'])
            .where('id', '=', id)
            .executeTakeFirst();
        if (!row) return undefined;

        const lineup = new Lineup(
            {
                id: row.id,
                name: row.name,
                mode: row.mode,
                onEnd: row.onEnd,
                source: row.source,
                ...(row.sourcePluginId == null ? {} : { sourcePluginId: row.sourcePluginId }),
                ...(row.sourcePlaylistId == null ? {} : { sourcePlaylistId: row.sourcePlaylistId }),
                ...(row.rules == null ? {} : { rules: row.rules as LineupRules }),
            },
            toItems(row.items),
            row.revision,
            cursor,
        );
        lineup.bindStore(this);
        return lineup;
    }

    /** Create one, optionally with its order already in it. Returns it bound and ready. */
    async create(input: NewLineup): Promise<Lineup> {
        const row = await this.db
            .insertInto('deadair.lineups')
            .values({
                name: input.name,
                ...(input.mode === undefined ? {} : { mode: input.mode }),
                ...(input.onEnd === undefined ? {} : { onEnd: input.onEnd }),
                ...(input.source === undefined ? {} : { source: input.source }),
                sourcePluginId: input.sourcePluginId ?? null,
                sourcePlaylistId: input.sourcePlaylistId ?? null,
                rules: jsonb(input.rules),
                items: jsonb([]),
            })
            .returning(['id', 'mode', 'onEnd', 'source', 'revision'])
            .executeTakeFirstOrThrow();

        const lineup = new Lineup(
            {
                id: row.id,
                name: input.name,
                mode: row.mode,
                onEnd: row.onEnd,
                source: row.source,
                ...(input.sourcePluginId === undefined ? {} : { sourcePluginId: input.sourcePluginId }),
                ...(input.sourcePlaylistId === undefined ? {} : { sourcePlaylistId: input.sourcePlaylistId }),
                ...(input.rules === undefined ? {} : { rules: input.rules }),
            },
            [],
            row.revision,
        );
        lineup.bindStore(this);
        // Through the lineup rather than in the insert above, so the items land in
        // exactly the shape it will read back and the revision moves with them.
        if (input.tracks?.length) await lineup.append(input.tracks);
        return lineup;
    }

    /** Rename, or change what kind of programming it is. */
    async update(id: string, changes: { name?: string; mode?: LineupMode; onEnd?: LineupOnEnd; rules?: LineupRules }): Promise<void> {
        const values = {
            ...(changes.name === undefined ? {} : { name: changes.name }),
            ...(changes.mode === undefined ? {} : { mode: changes.mode }),
            ...(changes.onEnd === undefined ? {} : { onEnd: changes.onEnd }),
            ...(changes.rules === undefined ? {} : { rules: jsonb(changes.rules) }),
        };
        if (Object.keys(values).length === 0) return;

        await this.db.updateTable('deadair.lineups').set(values).where('id', '=', id).execute();
    }

    /**
     * Delete one. The caller is responsible for refusing to delete what is on
     * air; `station_air` clears its pointer either way rather than holding a
     * reference to a row that is gone.
     */
    async remove(id: string): Promise<void> {
        await this.db.deleteFrom('deadair.lineups').where('id', '=', id).execute();
    }

    // ── LineupStore ────────────────────────────────────────────────────────────

    /**
     * Persist an order, guarded on the revision it was derived from.
     *
     * The guard is what makes two writers safe without a lock: the update matches
     * only while the stored revision is still the one this order was built on, so
     * a director appending at the same moment an operator reorders cannot
     * overwrite the other's list with a stale copy. A no-op update is silent
     * here — {@link Lineup} has already refused the edit that could produce one.
     */
    async saveItems(lineupId: string, items: readonly LineupItem[], revision: number): Promise<void> {
        await this.db
            .updateTable('deadair.lineups')
            .set({ items: jsonb(items), revision })
            .where('id', '=', lineupId)
            .where('revision', '<', revision)
            .execute();
    }

    /**
     * The cursor is broadcast state, not plan state, so this hands it to the
     * other table rather than writing here. Implemented so a `Lineup` has one
     * store to bind rather than two.
     */
    async saveCursor(lineupId: string, cursor: number): Promise<void> {
        await this.db.updateTable('deadair.stationAir').set({ cursor }).where('lineupId', '=', lineupId).execute();
    }
}

/** Kysely wants a string for a jsonb column; the generated type says otherwise. */
const jsonb = (value: unknown): never | null => (value === undefined ? null : (JSON.stringify(value) as unknown as never));

/**
 * Read an order back out of jsonb.
 *
 * Defensive because this is the one place a hand-edited row, or a shape from an
 * older version of the app, reaches live code. A line that is not a line is
 * dropped rather than aired as `undefined`, which would fail to resolve and take
 * the station off air for the length of an item.
 *
 * A missing `kind` reads as a track. Every line written before segments existed
 * has no such field, and they are all records; inferring it from the shape
 * instead would be the same answer arrived at less clearly.
 */
const toItems = (value: unknown): LineupItem[] => {
    if (!Array.isArray(value)) return [];

    return value.reduce<LineupItem[]>((items, raw) => {
        // Described as the JSON it is rather than as a `Partial` of the union: intersecting the two
        // arms collapses their literal `kind`s to `never` and takes every other field with it.
        const line = raw as { id?: unknown; kind?: unknown; segmentId?: unknown; over?: { atMs?: unknown }; track?: Partial<RundownTrack> } | null;
        if (typeof line?.id !== 'string') return items;

        if (line.kind === 'segment') {
            if (typeof line.segmentId !== 'string') return items;
            // A malformed `over` reads as absent rather than as a cue at zero: a talk-over that
            // fires the instant a record starts is worse than one that plays in the gap, and a
            // hand-edited row should degrade to the simpler behaviour.
            const atMs = typeof line.over?.atMs === 'number' && line.over.atMs >= 0 ? line.over.atMs : undefined;
            items.push({ id: line.id, kind: 'segment', segmentId: line.segmentId, ...(atMs === undefined ? {} : { over: { atMs } }) });
            return items;
        }

        if (typeof line.track?.externalId === 'string' && typeof line.track.pluginId === 'string') {
            items.push({ id: line.id, kind: 'track', track: line.track as RundownTrack });
        }
        return items;
    }, []);
};

export type { LineupSnapshot };
