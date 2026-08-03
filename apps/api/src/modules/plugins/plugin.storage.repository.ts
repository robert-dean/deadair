import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import { httpError } from '@maroonedsoftware/errors';
import { DataRepository } from '../data/data.repository.js';

/** Hard cap on how many keys a single plugin may hold. */
export const PLUGIN_STORAGE_MAX_KEYS = 200;

/** Hard cap on the JSON-serialized size of a single stored value. */
export const PLUGIN_STORAGE_MAX_VALUE_BYTES = 64 * 1024;

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, match => `\\${match}`);

/**
 * Namespaced key/value store backing `host.storage`. Every method is scoped by
 * `pluginId`; a plugin can never read or write another plugin's rows.
 *
 * Both quotas are enforced here rather than in the host so that a plugin
 * cannot reach the table through any other path and skip them.
 */
@Injectable()
export class PluginStorageRepository extends DataRepository {
    /** Resolves to `undefined` when the key was never set. */
    async get(pluginId: string, key: string): Promise<unknown> {
        const row = await this.db
            .selectFrom('deadair.pluginStorage')
            .select('value')
            .where('pluginId', '=', pluginId)
            .where('key', '=', key)
            .executeTakeFirst();
        return row ? (row.value as unknown) : undefined;
    }

    /**
     * Write a JSON-serializable value.
     *
     * @throws 422 when the value cannot be serialized, 413 when it exceeds
     *   {@link PLUGIN_STORAGE_MAX_VALUE_BYTES}, and 507 when storing a new key
     *   would push the plugin past {@link PLUGIN_STORAGE_MAX_KEYS}.
     */
    async set(pluginId: string, key: string, value: unknown): Promise<void> {
        const serialized = JSON.stringify(value);
        if (serialized === undefined) {
            throw httpError(422).withDetails({ message: `plugin storage value for key "${key}" is not JSON-serializable` });
        }
        const size = Buffer.byteLength(serialized, 'utf8');
        if (size > PLUGIN_STORAGE_MAX_VALUE_BYTES) {
            throw httpError(413).withDetails({
                message: `plugin storage value for key "${key}" is ${size} bytes, over the ${PLUGIN_STORAGE_MAX_VALUE_BYTES} byte limit`,
            });
        }

        // The row cap is applied inside the statement so two concurrent writers
        // cannot both pass a separate count check and land row 201.
        const result = await sql<{ key: string }>`
            insert into deadair.plugin_storage (plugin_id, key, value)
            select ${pluginId}, ${key}, ${serialized}::jsonb
            where exists (select 1 from deadair.plugin_storage existing where existing.plugin_id = ${pluginId} and existing.key = ${key})
               or (select count(*) from deadair.plugin_storage owned where owned.plugin_id = ${pluginId}) < ${PLUGIN_STORAGE_MAX_KEYS}
            on conflict (plugin_id, key) do update set value = excluded.value
            returning key
        `.execute(this.db);

        if (result.rows.length === 0) {
            throw httpError(507).withDetails({ message: `plugin storage is full: at most ${PLUGIN_STORAGE_MAX_KEYS} keys per plugin` });
        }
    }

    async delete(pluginId: string, key: string): Promise<void> {
        await this.db.deleteFrom('deadair.pluginStorage').where('pluginId', '=', pluginId).where('key', '=', key).execute();
    }

    /** Keys held by this plugin, optionally limited to those starting with `prefix`. */
    async listKeys(pluginId: string, prefix?: string): Promise<string[]> {
        let query = this.db.selectFrom('deadair.pluginStorage').select('key').where('pluginId', '=', pluginId);
        if (prefix) query = query.where('key', 'like', `${escapeLike(prefix)}%`);
        const rows = await query.orderBy('key', 'asc').execute();
        return rows.map(row => row.key);
    }

    /** Drops every key held by a plugin. Used when a plugin is uninstalled. */
    async deleteAll(pluginId: string): Promise<void> {
        await this.db.deleteFrom('deadair.pluginStorage').where('pluginId', '=', pluginId).execute();
    }
}
