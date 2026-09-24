import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository } from '#modules/data/data.repository.js';

/** A chat account linked to a station account, as the console lists it. */
export interface MessagingLinkRow {
    pluginId: string;
    platformUserId: string;
    displayName: string;
    createdAt: DateTime;
}

/**
 * What the station remembers about chat platforms: where it has read up to on each
 * (`deadair.messaging_cursors`), and which chat accounts are which station accounts
 * (`deadair.messaging_identities`, `deadair.messaging_link_codes`).
 *
 * The cursor is the plugin's, opaque, and only ever stored and handed back. See the migrations for
 * why each is a table rather than memory.
 */
@Injectable()
export class MessagingRepository extends DataRepository {
    /** The cursor last saved for this plugin, or nothing when it has never been polled. */
    async readCursor(pluginId: string): Promise<string | undefined> {
        const row = await this.db.selectFrom('deadair.messagingCursors').select('cursor').where('pluginId', '=', pluginId).executeTakeFirst();
        return row?.cursor;
    }

    /** Remember where this plugin's stream has been read up to. */
    async saveCursor(pluginId: string, cursor: string): Promise<void> {
        await this.db
            .insertInto('deadair.messagingCursors')
            .values({ pluginId, cursor })
            .onConflict(oc => oc.column('pluginId').doUpdateSet({ cursor, updatedAt: sql<DateTime>`now()` }))
            .execute();
    }

    /** Replace whatever code this account had with a new one. Only the hash is stored. */
    async saveLinkCode(actorId: string, codeHash: string, expiresAt: DateTime): Promise<void> {
        await this.db
            .insertInto('deadair.messagingLinkCodes')
            .values({ actorId, codeHash, expiresAt })
            .onConflict(oc => oc.column('actorId').doUpdateSet({ codeHash, expiresAt, createdAt: sql<DateTime>`now()` }))
            .execute();
    }

    /**
     * Use up a code: delete it and answer whose it was, or nothing when no live code has this hash.
     *
     * One statement, so two chats racing the same code cannot both win it. An expired code is
     * deleted too and answers nothing.
     */
    async consumeLinkCode(codeHash: string): Promise<string | undefined> {
        const row = await this.db
            .deleteFrom('deadair.messagingLinkCodes')
            .where('codeHash', '=', codeHash)
            .returning(['actorId', sql<boolean>`expires_at > now()`.as('live')])
            .executeTakeFirst();
        return row?.live === true ? row.actorId : undefined;
    }

    /** Link one chat account to one station account, replacing any earlier link for that chat account. */
    async link(pluginId: string, platformUserId: string, actorId: string, displayName: string): Promise<void> {
        await this.db
            .insertInto('deadair.messagingIdentities')
            .values({ pluginId, platformUserId, actorId, displayName })
            .onConflict(oc => oc.columns(['pluginId', 'platformUserId']).doUpdateSet({ actorId, displayName, createdAt: sql<DateTime>`now()` }))
            .execute();
    }

    /** The station account this chat account is linked to, if it is. */
    async linkedActor(pluginId: string, platformUserId: string): Promise<string | undefined> {
        const row = await this.db
            .selectFrom('deadair.messagingIdentities')
            .select('actorId')
            .where('pluginId', '=', pluginId)
            .where('platformUserId', '=', platformUserId)
            .executeTakeFirst();
        return row?.actorId;
    }

    /** Every chat account linked to this station account, newest first. */
    async links(actorId: string): Promise<MessagingLinkRow[]> {
        return this.db
            .selectFrom('deadair.messagingIdentities')
            .select(['pluginId', 'platformUserId', 'displayName', 'createdAt'])
            .where('actorId', '=', actorId)
            .orderBy('createdAt', 'desc')
            .execute();
    }

    /**
     * Remove a link. `actorId` narrows it to one account's own links when the console asks; the chat
     * side's `/unlink` passes nothing, since the chat account is the one asking. Answers whether a
     * link was removed.
     */
    async unlink(pluginId: string, platformUserId: string, actorId?: string): Promise<boolean> {
        let query = this.db.deleteFrom('deadair.messagingIdentities').where('pluginId', '=', pluginId).where('platformUserId', '=', platformUserId);
        if (actorId !== undefined) query = query.where('actorId', '=', actorId);
        const result = await query.executeTakeFirst();
        return Number(result.numDeletedRows) > 0;
    }
}
