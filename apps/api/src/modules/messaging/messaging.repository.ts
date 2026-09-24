import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository } from '#modules/data/data.repository.js';

/**
 * Where the station has read up to on each chat platform: `deadair.messaging_cursors`.
 *
 * The cursor is the plugin's, opaque, and only ever stored and handed back. See the migration for
 * why it is a table rather than memory.
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
}
