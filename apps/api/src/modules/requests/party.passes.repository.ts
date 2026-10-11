import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository } from '#modules/data/data.repository.js';

/** A pass as the module reads it. */
export interface PartyPassRow {
    id: string;
    tokenSealed: string;
    createdAt: DateTime;
    expiresAt: DateTime;
}

/** What {@link PartyPassRepository.create} is given. */
export interface NewPartyPass {
    createdBy?: string;
    tokenHash: string;
    tokenSealed: string;
    expiresAt: DateTime;
}

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

    /** The live pass, if a party is on. There is at most one: starting a party ends the last. */
    async live(): Promise<PartyPassRow | undefined> {
        return await this.db
            .selectFrom('deadair.partyPasses')
            .select(['id', 'tokenSealed', 'createdAt', 'expiresAt'])
            .where('endedAt', 'is', null)
            .where('expiresAt', '>', sql<DateTime>`now()`)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .executeTakeFirst();
    }

    /** The live pass a token belongs to, found by the token's hash. */
    async liveByHash(tokenHash: string): Promise<PartyPassRow | undefined> {
        return await this.db
            .selectFrom('deadair.partyPasses')
            .select(['id', 'tokenSealed', 'createdAt', 'expiresAt'])
            .where('tokenHash', '=', tokenHash)
            .where('endedAt', 'is', null)
            .where('expiresAt', '>', sql<DateTime>`now()`)
            .executeTakeFirst();
    }

    async create(pass: NewPartyPass): Promise<PartyPassRow> {
        return await this.db
            .insertInto('deadair.partyPasses')
            .values({
                ...(pass.createdBy === undefined ? {} : { createdBy: pass.createdBy }),
                tokenHash: pass.tokenHash,
                tokenSealed: pass.tokenSealed,
                expiresAt: pass.expiresAt,
            })
            .returning(['id', 'tokenSealed', 'createdAt', 'expiresAt'])
            .executeTakeFirstOrThrow();
    }

    /**
     * End every pass that has not ended, and answer the guests who joined with them, so the caller
     * can switch them off. Every rather than one: a pass that ran out is ended here too, which costs
     * nothing and leaves no live-looking row behind.
     */
    async endAll(): Promise<string[]> {
        const ended = await this.db
            .updateTable('deadair.partyPasses')
            .set({ endedAt: sql<DateTime>`now()` })
            .where('endedAt', 'is', null)
            .returning('id')
            .execute();
        if (ended.length === 0) return [];
        const guests = await this.db
            .selectFrom('deadair.partyGuests')
            .select('actorId')
            .where(
                'passId',
                'in',
                ended.map(row => row.id),
            )
            .execute();
        return guests.map(row => row.actorId);
    }

    async addGuest(passId: string, actorId: string): Promise<void> {
        await this.db.insertInto('deadair.partyGuests').values({ passId, actorId }).execute();
    }

    async guestCount(passId: string): Promise<number> {
        const row = await this.db
            .selectFrom('deadair.partyGuests')
            .select(eb => eb.fn.countAll<string>().as('n'))
            .where('passId', '=', passId)
            .executeTakeFirstOrThrow();
        return Number(row.n);
    }
}
