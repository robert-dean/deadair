import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository } from '#modules/data/data.repository.js';

/**
 * Party passes, `deadair.party_passes`, and the guests who joined with them, `deadair.party_guests`.
 * See migration 0085 for what a pass is.
 */
@Injectable()
export class PartyPassRepository extends DataRepository {
    /**
     * Whether a pass still lets its guests in: it exists, nobody ended it, and it has not run out.
     * Asked on every guest request, so it answers the one question and selects nothing else.
     */
    async isLive(id: string): Promise<boolean> {
        const row = await this.db
            .selectFrom('deadair.partyPasses')
            .select(sql`1`.as('one'))
            .where('id', '=', id)
            .where('endedAt', 'is', null)
            .where('expiresAt', '>', sql<DateTime>`now()`)
            .limit(1)
            .executeTakeFirst();
        return row !== undefined;
    }
}
