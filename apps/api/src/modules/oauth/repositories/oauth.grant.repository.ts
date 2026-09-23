import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { Selectable } from 'kysely';
import { OAuthGrantRepository, type OAuthGrant, type OAuthGrantInput } from '@maroonedsoftware/authentication';
import { DataRepository, type DeadairOauthGrants } from '#src/modules/data/data.repository.js';

/**
 * One operator's approval of one app for one resource. `OAuthGrantRepository` for the library, which
 * upserts one at every code exchange and refuses a refresh on a revoked one, plus the list and the
 * revoke the Security page needs.
 */
@Injectable()
export class DeadairOAuthGrantRepository extends DataRepository implements OAuthGrantRepository {
    /** Approving the same app again reuses the grant, takes the new scope, and un-revokes it. */
    async upsert(grant: OAuthGrantInput): Promise<OAuthGrant> {
        const row = await this.db
            .insertInto('deadair.oauthGrants')
            .values({ clientId: grant.clientId, actorId: grant.subject, resource: grant.resource, scope: grant.scope })
            .onConflict(conflict => conflict.columns(['clientId', 'actorId', 'resource']).doUpdateSet({ scope: grant.scope, revokedAt: null }))
            .returningAll()
            .executeTakeFirstOrThrow();
        return toGrant(row);
    }

    async find(id: string): Promise<OAuthGrant | undefined> {
        const row = await this.db.selectFrom('deadair.oauthGrants').selectAll().where('id', '=', id).executeTakeFirst();
        return row ? toGrant(row) : undefined;
    }

    async recordUse(id: string, at: DateTime): Promise<void> {
        await this.db.updateTable('deadair.oauthGrants').set({ lastUsedAt: at }).where('id', '=', id).execute();
    }

    /** One person's standing approvals, most recent first. */
    async listForActor(actorId: string): Promise<OAuthGrant[]> {
        const rows = await this.db
            .selectFrom('deadair.oauthGrants')
            .selectAll()
            .where('actorId', '=', actorId)
            .where('revokedAt', 'is', null)
            .orderBy('createdAt', 'desc')
            .execute();
        return rows.map(toGrant);
    }

    /** Withdraw every approval of one app, for everybody, as withdrawing the app itself does. */
    async revokeForClient(clientId: string): Promise<OAuthGrant[]> {
        const rows = await this.db
            .updateTable('deadair.oauthGrants')
            .set({ revokedAt: DateTime.utc() })
            .where('clientId', '=', clientId)
            .where('revokedAt', 'is', null)
            .returningAll()
            .execute();
        return rows.map(toGrant);
    }

    /** Withdraw one of this person's approvals. Answers the grant withdrawn, or nothing if it was not theirs. */
    async revoke(id: string, actorId: string): Promise<OAuthGrant | undefined> {
        const row = await this.db
            .updateTable('deadair.oauthGrants')
            .set({ revokedAt: DateTime.utc() })
            .where('id', '=', id)
            .where('actorId', '=', actorId)
            .where('revokedAt', 'is', null)
            .returningAll()
            .executeTakeFirst();
        return row ? toGrant(row) : undefined;
    }
}

function toGrant(row: Selectable<DeadairOauthGrants>): OAuthGrant {
    return {
        id: row.id,
        clientId: row.clientId,
        subject: row.actorId,
        resource: row.resource,
        scope: row.scope,
        createdAt: row.createdAt,
        ...(row.lastUsedAt == null ? {} : { lastUsedAt: row.lastUsedAt }),
        ...(row.revokedAt == null ? {} : { revokedAt: row.revokedAt }),
    };
}
