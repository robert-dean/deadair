import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import {
    PERSONA_TELLING_SAID_LIMIT,
    type PersonaTelling,
    type PersonaTellingMode,
    type PersonaTellingSource,
    type PersonaTellingWrite,
} from './persona.telling.js';

/** A telling with the handle of the story it told, which is what a timeline lists. */
export interface PersonaTellingEntry extends PersonaTelling {
    title: string;
}

/**
 * The ledger of what each character has actually told, and when.
 *
 * Append-only, as `ScriptHistoryRepository`'s table is and for the same reason: every row is a fact
 * about a moment. Nothing here updates a telling except {@link markAired}, which fills in a column
 * that was unknowable when the row was written, and {@link replaceForSegment}, which is a delete and
 * an insert rather than an edit.
 *
 * ## One row per segment, because a rewrite is not a second telling
 *
 * Segments are reopened and rewritten constantly, and every rewrite of one break is still one thing
 * a listener hears. {@link replaceForSegment} is therefore the only way a break writes here: it
 * clears whatever the last attempt left and writes what this one did, INCLUDING writing nothing,
 * because a rewrite under a different presenter that carries no story has to take the stale row with
 * it or the aired edge stamps a telling that never went out.
 *
 * ## What this is read for
 *
 * The rotation (which story comes round next), a story's own progress (which part is owed), what a
 * later break is shown so it can refer back, the console's timeline, and the rollback that deletes
 * over it. All five are reads of one table, which is the whole reason it is one table.
 */
@Injectable()
export class PersonaTellingRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly station: StationIdentity,
    ) {
        super(db);
    }

    /**
     * Writes one telling.
     *
     * The caller is whoever actually put the words somewhere — see {@link replaceForSegment} for the
     * break path, which is every caller that has a segment.
     */
    async record(write: PersonaTellingWrite): Promise<void> {
        await this.db.insertInto('deadair.personaTellings').values(this.valuesFor(write)).execute();
    }

    /**
     * Makes the ledger say exactly what this segment's winning script did, and nothing it used to.
     *
     * Two statements rather than an upsert, because the second is CONDITIONAL: a break rewritten
     * into something that carries no story has to leave no row at all, and an upsert has no way to
     * express that. Passing `undefined` is therefore a legitimate call and not a no-op.
     */
    async replaceForSegment(segmentId: string, write: PersonaTellingWrite | undefined): Promise<void> {
        await this.db
            .deleteFrom('deadair.personaTellings')
            .where('stationKey', '=', this.station.stationKey)
            .where('segmentId', '=', segmentId)
            .execute();

        if (write === undefined) return;

        await this.record({ ...write, segmentId });
    }

    /**
     * A listener could have heard whatever this segment carried.
     *
     * Keyed on the segment, as `NarrationPieceRepository.markAired` is, because that is what the
     * aired edge holds; one statement matching nothing is cheaper than asking first whether this
     * segment carried a story at all. `coalesce` keeps the FIRST airing, so a segment re-aired by
     * hand has not stopped having been heard.
     */
    async markAired(segmentId: string, at: number): Promise<void> {
        await this.db
            .updateTable('deadair.personaTellings')
            .set({ airedAt: sql<never>`coalesce(aired_at, ${instant(at)})` })
            .where('stationKey', '=', this.station.stationKey)
            .where('segmentId', '=', segmentId)
            .execute();
    }

    /**
     * What this character has told, newest first, with the handle of each story.
     *
     * The console's read and the one a rollback is chosen against, which is why every row carries
     * {@link PersonaTelling.at} as the column's own text: that string is handed straight back as the
     * moment to roll back to.
     */
    async timeline(personaKey: string, limit = 100): Promise<PersonaTellingEntry[]> {
        const rows = await this.db
            .selectFrom('deadair.personaTellings as telling')
            .innerJoin('deadair.personaStories as story', 'story.id', 'telling.storyId')
            .select([
                'telling.id',
                'telling.personaKey',
                'telling.storyId',
                'telling.segmentId',
                'telling.source',
                'telling.mode',
                'telling.told',
                'telling.said',
                'story.title',
                sql<string>`telling.created_at::text`.as('at'),
                sql<string | null>`telling.aired_at::text`.as('airedAt'),
            ])
            .where('telling.stationKey', '=', this.station.stationKey)
            .where('telling.personaKey', '=', personaKey)
            .orderBy('telling.createdAt', 'desc')
            .orderBy('telling.id', 'desc')
            .limit(limit)
            .execute();

        return rows.map(row => ({
            id: row.id,
            personaKey: row.personaKey,
            storyId: row.storyId,
            title: row.title,
            source: row.source as PersonaTellingSource,
            mode: row.mode as PersonaTellingMode,
            told: row.told,
            at: row.at,
            ...(row.segmentId == null ? {} : { segmentId: row.segmentId }),
            ...(row.said == null ? {} : { said: row.said }),
            ...(row.airedAt == null ? {} : { airedAt: row.airedAt }),
        }));
    }

    /**
     * The last few times one story actually went out, newest first.
     *
     * Only rows that were TOLD and AIRED, because this is what a later break is shown so it can
     * pick a thread back up, and a story written into a break that was dropped is one no listener
     * has heard. Offering it as somewhere the character has already been would have the presenter
     * refer back to something that never happened.
     */
    async lastFor(storyId: string, limit = 2): Promise<PersonaTelling[]> {
        const rows = await this.db
            .selectFrom('deadair.personaTellings')
            .select([
                'id',
                'personaKey',
                'storyId',
                'segmentId',
                'source',
                'mode',
                'told',
                'said',
                sql<string>`created_at::text`.as('at'),
                sql<string | null>`aired_at::text`.as('airedAt'),
            ])
            .where('stationKey', '=', this.station.stationKey)
            .where('storyId', '=', storyId)
            .where('told', '=', true)
            .where('airedAt', 'is not', null)
            .orderBy('createdAt', 'desc')
            .orderBy('id', 'desc')
            .limit(limit)
            .execute();

        return rows.map(row => ({
            id: row.id,
            personaKey: row.personaKey,
            storyId: row.storyId,
            source: row.source as PersonaTellingSource,
            mode: row.mode as PersonaTellingMode,
            told: row.told,
            at: row.at,
            ...(row.segmentId == null ? {} : { segmentId: row.segmentId }),
            ...(row.said == null ? {} : { said: row.said }),
            ...(row.airedAt == null ? {} : { airedAt: row.airedAt }),
        }));
    }

    /** How many tellings a rollback to this moment would undo. Same predicate as {@link removeAfter}. */
    async countAfter(personaKey: string, to: string): Promise<number> {
        const row = await this.db
            .selectFrom('deadair.personaTellings')
            .select(sql<string>`count(*)`.as('count'))
            .where('stationKey', '=', this.station.stationKey)
            .where('personaKey', '=', personaKey)
            .where(sql<boolean>`created_at > ${to}::timestamptz`)
            .executeTakeFirstOrThrow();

        return Number(row.count);
    }

    /**
     * Forget everything this character told after a moment.
     *
     * Every row, whatever wrote it, which is the one place this feature does NOT sort by origin: a
     * telling is not a claim somebody made, it is a record of something the station did, and an
     * operator rolling back to Tuesday means the station had not yet done it. The rows an operator
     * authored by hand are stories and notes, and those are sorted by origin where they live.
     */
    async removeAfter(personaKey: string, to: string): Promise<number> {
        const removed = await this.db
            .deleteFrom('deadair.personaTellings')
            .where('stationKey', '=', this.station.stationKey)
            .where('personaKey', '=', personaKey)
            .where(sql<boolean>`created_at > ${to}::timestamptz`)
            .executeTakeFirst();

        return Number(removed.numDeletedRows);
    }

    private valuesFor(write: PersonaTellingWrite) {
        const said = write.said?.trim();

        return {
            stationKey: this.station.stationKey,
            personaKey: write.personaKey,
            storyId: write.storyId,
            beatId: write.beatId ?? null,
            segmentId: write.segmentId ?? null,
            source: write.source,
            mode: write.mode,
            told: write.told,
            said: said === undefined || said === '' ? null : said.slice(0, PERSONA_TELLING_SAID_LIMIT),
        };
    }
}

/** As `NarrationPieceRepository` and `StationLineupRepository` both spell it. */
const instant = (millis: number) => sql<never>`to_timestamp(${millis} / 1000.0)`;
