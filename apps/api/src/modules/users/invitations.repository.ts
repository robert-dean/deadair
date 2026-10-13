import { Injectable } from 'injectkit';
import { sql, type Selectable } from 'kysely';
import { DateTime } from 'luxon';
import { DataRepository, type DeadairInvitations } from '#modules/data/data.repository.js';

/** An invitation as stored, plus the address of whoever made it. */
export type InvitationRow = Selectable<DeadairInvitations> & { inviterEmail: string | null };

export interface NewInvitation {
    email: string;
    role: 'admin' | 'listener';
    tokenHash: string;
    tokenSealed: string;
    expiresAt: DateTime;
    invitedBy: string;
}

/** How many invitations the console lists. A station invites dozens of people, not thousands. */
export const INVITATION_LIST_LIMIT = 200;

// The inviter's address is their oldest active email factor, as the users list reads it.
const INVITER_EMAIL = sql<string | null>`(
    select e.value from deadair.actors_email_factors e
    where e.actor_id = invitations.invited_by and e.active order by e.created_at limit 1
)`;

/**
 * `deadair.invitations`. Nothing here deletes a row: withdrawing, superseding and accepting are all
 * changes of `state`, so the table is also the record of who invited whom.
 */
@Injectable()
export class InvitationsRepository extends DataRepository {
    async create(invitation: NewInvitation): Promise<InvitationRow> {
        const row = await this.db
            .insertInto('deadair.invitations')
            .values({ ...invitation, state: 'pending' })
            .returning('id')
            .executeTakeFirstOrThrow();
        return (await this.get(row.id))!;
    }

    async get(id: string): Promise<InvitationRow | undefined> {
        return await this.db
            .selectFrom('deadair.invitations')
            .selectAll('deadair.invitations')
            .select(INVITER_EMAIL.as('inviterEmail'))
            .where('id', '=', id)
            .executeTakeFirst();
    }

    async list(): Promise<InvitationRow[]> {
        return await this.db
            .selectFrom('deadair.invitations')
            .selectAll('deadair.invitations')
            .select(INVITER_EMAIL.as('inviterEmail'))
            .orderBy('createdAt', 'desc')
            .orderBy('id')
            .limit(INVITATION_LIST_LIMIT)
            .execute();
    }

    /**
     * Withdraw every invitation still pending for `email`, expired ones included: an expired row is
     * still `pending` in the table, and the one-pending-per-address index counts it.
     */
    async revokePendingFor(email: string, revokedBy: string): Promise<void> {
        await this.db
            .updateTable('deadair.invitations')
            .set({ state: 'revoked', revokedAt: DateTime.utc(), revokedBy })
            .where(sql<string>`lower(email)`, '=', email.toLowerCase())
            .where('state', '=', 'pending')
            .execute();
    }

    /** Withdraw one invitation. Answers it, or nothing when it was not pending. */
    async revoke(id: string, revokedBy: string): Promise<InvitationRow | undefined> {
        const row = await this.db
            .updateTable('deadair.invitations')
            .set({ state: 'revoked', revokedAt: DateTime.utc(), revokedBy })
            .where('id', '=', id)
            .where('state', '=', 'pending')
            .returning('id')
            .executeTakeFirst();
        return row ? await this.get(row.id) : undefined;
    }

    /** The invitation a token names, if it is still open: pending and inside its time. */
    async openByHash(tokenHash: string): Promise<InvitationRow | undefined> {
        return await this.db
            .selectFrom('deadair.invitations')
            .selectAll('deadair.invitations')
            .select(INVITER_EMAIL.as('inviterEmail'))
            .where('tokenHash', '=', tokenHash)
            .where('state', '=', 'pending')
            .where('expiresAt', '>', DateTime.utc())
            .executeTakeFirst();
    }

    /**
     * Spend an invitation on `acceptedBy`, only if it is still open. One statement, so two people
     * accepting at once cannot both win: the second waits on the first's row lock and then finds it
     * no longer pending. Answers nothing when it was not open.
     */
    async consume(tokenHash: string, acceptedBy: string): Promise<InvitationRow | undefined> {
        const row = await this.db
            .updateTable('deadair.invitations')
            .set({ state: 'accepted', acceptedAt: DateTime.utc(), acceptedBy })
            .where('tokenHash', '=', tokenHash)
            .where('state', '=', 'pending')
            .where('expiresAt', '>', DateTime.utc())
            .returning('id')
            .executeTakeFirst();
        return row ? await this.get(row.id) : undefined;
    }
}
