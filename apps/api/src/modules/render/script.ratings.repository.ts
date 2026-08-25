import { Injectable } from 'injectkit';
import { Kysely } from 'kysely';
import { DataRepository } from '../data/data.repository.js';
import { DB } from '../data/db.js';
import { StationIdentity } from '../shared/station.identity.js';

/**
 * What the operator thought of what the station said.
 *
 * One row per attempt per station, so saying it again replaces the last answer rather than
 * accumulating a history of moods. The opinion is stored as the catalog's number and translated at
 * the edges by `catalog/rating.ts`, which is the one place the two spellings meet.
 *
 * Its own repository rather than a method on the history one, because the two tables have opposite
 * shapes on purpose: `script_history` is append-only and takes no edits, and this is nothing but
 * edits. Keeping the writer of one out of the other is what stops somebody eventually adding an
 * `update` to the table whose whole design is that it never takes one.
 */
@Injectable()
export class ScriptRatingsRepository extends DataRepository {
    /** Injected for the reason `ScriptHistoryRepository` spells out: the writers here are jobs. */
    constructor(
        db: Kysely<DB>,
        private readonly identity: StationIdentity,
    ) {
        super(db);
    }

    /**
     * Records an opinion, replacing whatever this station said last.
     *
     * Answers false when the attempt does not exist, which the caller turns into a 404 rather than
     * writing a rating for a row nobody can read back. The foreign key would refuse it anyway; this
     * asks first so the answer is a sentence rather than a constraint violation.
     */
    async rate(scriptId: string, rating: number, actorId?: string): Promise<boolean> {
        const exists = await this.db
            .selectFrom('deadair.scriptHistory')
            .select('id')
            .where('id', '=', scriptId)
            .where('stationKey', '=', this.identity.stationKey)
            .executeTakeFirst();

        if (exists === undefined) return false;

        await this.db
            .insertInto('deadair.scriptRatings')
            .values({ scriptId, stationKey: this.identity.stationKey, rating, ...(actorId === undefined ? {} : { actorId }) })
            // The actor moves with the opinion: whoever changed their mind is who holds it now, and
            // leaving the first rater's name on a verdict they no longer gave would be worse than
            // carrying nobody's.
            .onConflict(oc => oc.columns(['stationKey', 'scriptId']).doUpdateSet({ rating, actorId: actorId ?? null }))
            .execute();

        return true;
    }
}
