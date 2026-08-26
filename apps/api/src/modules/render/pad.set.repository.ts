import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';

/** One named collection of pads: what a presenter is handed. */
export interface PadSet {
    id: string;
    /** The slug `personas.soundboard` holds. */
    key: string;
    label: string;
    position: number;
    /** How many pads are on it, for a console drawing a list. */
    pads: number;
}

/** A set before it is a row. */
export interface PadSetDraft {
    key: string;
    label: string;
    position?: number;
}

/**
 * The station's soundboards: which pads a presenter can actually reach.
 *
 * `TopicRepository`'s shape and its posture — a plain reader and writer that decides nothing. What a
 * set MEANS is the break writer's business; this only says which rows are on it.
 *
 * ## The one rule it enforces that the schema cannot
 *
 * **A set may not hold two pads under one name.** A script writes a name, resolution happens within a
 * set, and two pads answering to `airhorn` on one set is a break that plays whichever the planner
 * returned first — the same script sounding different between two renders. It spans a join, so no
 * unique index expresses it and {@link add} refuses it instead.
 *
 * That is a rule about a SET and not about the library. Two pads called `airhorn` from two
 * directories are an ordinary thing to hold, and putting them on two sets is the feature: two
 * characters, two air horns, one token.
 */
@Injectable()
export class PadSetRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly station: StationIdentity,
    ) {
        super(db);
    }

    /**
     * This station's sets, in the operator's order, with what each holds.
     *
     * The id is a tiebreaker for `TopicRepository.list`'s reason: rows written in one statement share
     * a position as easily as a timestamp, and a list that reshuffles between reads is a page nobody
     * can use twice.
     *
     * The count is a `left join` rather than a second query, because an empty set is an ordinary
     * thing — it is what a seeded set looks like before anybody drops a file — and an inner join
     * would hide exactly the rows an operator is looking for.
     */
    async list(): Promise<PadSet[]> {
        const rows = await this.db
            .selectFrom('deadair.padSets as s')
            .leftJoin('deadair.padSetMembers as m', 'm.setId', 's.id')
            .select(({ fn }) => ['s.id', 's.key', 's.label', 's.position', fn.count<string>('m.padId').as('pads')])
            .where('s.stationKey', '=', this.station.stationKey)
            .groupBy(['s.id', 's.key', 's.label', 's.position'])
            .orderBy('s.position', 'asc')
            .orderBy('s.id', 'asc')
            .execute();

        return rows.map(row => ({ id: row.id, key: row.key, label: row.label, position: row.position, pads: Number(row.pads ?? 0) }));
    }

    /** One set by the key a persona names, or nothing. */
    async byKey(key: string): Promise<PadSet | undefined> {
        return (await this.list()).find(set => set.key === key.trim());
    }

    /** How many sets this station holds, which is what a seeder guards on. */
    async count(): Promise<number> {
        const row = await this.db
            .selectFrom('deadair.padSets')
            .select(({ fn }) => fn.countAll<string>().as('held'))
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return Number(row?.held ?? 0);
    }

    /**
     * Writes a set, or answers the one already under that key.
     *
     * `on conflict do nothing` and then a read, rather than a read and then a write, because the
     * import path calls this for every file in a directory: the second one through must find the set
     * the first made rather than race it.
     */
    async ensure(draft: PadSetDraft): Promise<PadSet> {
        await this.db
            .insertInto('deadair.padSets')
            .values({
                stationKey: this.station.stationKey,
                key: draft.key.trim(),
                label: draft.label.trim(),
                position: draft.position ?? 0,
            })
            .onConflict(conflict => conflict.doNothing())
            .execute();

        // Non-null: the insert either wrote it or something else already had.
        return (await this.byKey(draft.key))!;
    }

    /** Renames a set. The KEY moves too, which is why the caller has to warn about personas first. */
    async update(id: string, draft: PadSetDraft): Promise<boolean> {
        const result = await this.db
            .updateTable('deadair.padSets')
            .set({ key: draft.key.trim(), label: draft.label.trim(), ...(draft.position === undefined ? {} : { position: draft.position }) })
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return Number(result.numUpdatedRows) > 0;
    }

    /**
     * Removes a set and its memberships, and no pads at all.
     *
     * The cascade is on `pad_set_members`, so this takes the grouping away and leaves the library
     * exactly as it was — which is the whole difference between a set and a directory.
     */
    async remove(id: string): Promise<boolean> {
        const result = await this.db
            .deleteFrom('deadair.padSets')
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return Number(result.numDeletedRows) > 0;
    }

    /**
     * Puts a pad on a set, refusing a name the set already answers to.
     *
     * The refusal is the point and is stated as an outcome rather than a throw, because the caller
     * that hits it most is the IMPORT path — two directories holding `airhorn.wav` and an operator
     * pointing both at one set — and that is an ordinary thing to tell somebody about rather than an
     * error to fail a scan over.
     *
     * `already` means this exact pad is on it, which is what a re-scan produces and is silent.
     */
    async add(setId: string, padId: string): Promise<'added' | 'already' | 'name-taken'> {
        // ACTIVE only, and that is not a detail. A rejected pad is unreachable — `onSet` and `named`
        // both exclude it — so one sitting on a set blocks nothing at resolution time, and treating
        // it as a collision would mean turning an air horn down permanently reserved its name. Which
        // is the exact opposite of what `pads_name_idx` being partial is for one table over.
        //
        // Membership survives the rejection rather than being deleted with it, because rejecting is
        // reversible: put the pad back and it is on the sets it was on.
        const held = await this.db
            .selectFrom('deadair.padSetMembers as m')
            .innerJoin('deadair.pads as p', 'p.id', 'm.padId')
            .select(['m.padId'])
            .where('m.setId', '=', setId)
            .where('p.state', '=', 'active')
            .where(sql<boolean>`lower(btrim(p.name)) = (select lower(btrim(name)) from deadair.pads where id = ${padId}::uuid)`)
            .executeTakeFirst();

        if (held !== undefined) return held.padId === padId ? 'already' : 'name-taken';

        await this.db.insertInto('deadair.padSetMembers').values({ setId, padId }).onConflict(conflict => conflict.doNothing()).execute();
        return 'added';
    }

    /** Takes a pad off a set, leaving it in the library and on every other set. */
    async drop(setId: string, padId: string): Promise<boolean> {
        const result = await this.db
            .deleteFrom('deadair.padSetMembers')
            .where('setId', '=', setId)
            .where('padId', '=', padId)
            .executeTakeFirst();

        return Number(result.numDeletedRows) > 0;
    }

    /** Which sets one pad is on, so the console can draw a row's memberships without an N+1. */
    async setsFor(padIds: readonly string[]): Promise<Map<string, string[]>> {
        if (padIds.length === 0) return new Map();

        const rows = await this.db
            .selectFrom('deadair.padSetMembers as m')
            .innerJoin('deadair.padSets as s', 's.id', 'm.setId')
            .select(['m.padId', 's.key'])
            .where('m.padId', 'in', [...padIds])
            .orderBy('s.position', 'asc')
            .execute();

        const found = new Map<string, string[]>();
        for (const row of rows) found.set(row.padId, [...(found.get(row.padId) ?? []), row.key]);
        return found;
    }

    /**
     * Which personas name a set, so a rename or a delete can say what it is about to unpoint.
     *
     * `topics`' "and these go too" before a delete, and it matters more here than there: a band that
     * loses its subject loses its slot, where a persona that loses its rack goes on presenting in
     * silence about it. `personas.soundboard` holds a KEY and not a foreign key, so nothing in the
     * schema would say a word.
     */
    async personasNaming(key: string): Promise<string[]> {
        const rows = await this.db
            .selectFrom('deadair.personas')
            .select(['label'])
            .where('stationKey', '=', this.station.stationKey)
            .where('soundboard', '=', key.trim())
            .orderBy('label', 'asc')
            .execute();

        return rows.map(row => row.label);
    }
}
