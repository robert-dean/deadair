import { Injectable } from 'injectkit';
import { DataRepository } from '../data/data.repository.js';

/**
 * Raw access to the `deadair.settings` key/value table (dot-keyed, e.g.
 * `stream.title`).
 *
 * Values are stored as written: this layer knows nothing about which keys hold
 * a secret, so a caller storing one is the one that encrypts it (see
 * `EncryptionProvider`, and `STREAM_SECRET_KEYS` for the stream's set).
 *
 * Every write fires the `deadair_settings_changed` NOTIFY installed by
 * migration `0003_settings.sql`. Nothing listens on it yet; the stream config
 * is materialized at boot and by explicit calls (see `StreamService`).
 */
@Injectable()
export class SettingsRepository extends DataRepository {
    /** Resolves to `undefined` for both an absent row and a row storing SQL NULL. */
    async get(key: string): Promise<string | undefined> {
        const row = await this.db.selectFrom('deadair.settings').select('value').where('key', '=', key).executeTakeFirst();
        // A Kysely read hands back `undefined` for SQL NULL even though the generated
        // type says `string | null`, so this coalesces rather than comparing to null.
        return row?.value ?? undefined;
    }

    /**
     * The requested keys that hold a value, as a map. A key with no row (or a
     * null one) is simply absent from it, which is what lets a caller tell
     * "never set" from "set to the empty string" without a second query.
     */
    async getMany(keys: string[]): Promise<Map<string, string>> {
        const values = new Map<string, string>();
        if (keys.length === 0) return values;

        const rows = await this.db.selectFrom('deadair.settings').select(['key', 'value']).where('key', 'in', keys).execute();
        for (const row of rows) {
            if (row.value != null) values.set(row.key, row.value);
        }
        return values;
    }

    /** Every setting that holds a value. For diagnostics and export; prefer {@link getMany}. */
    async all(): Promise<Map<string, string>> {
        const rows = await this.db.selectFrom('deadair.settings').select(['key', 'value']).execute();
        const values = new Map<string, string>();
        for (const row of rows) {
            if (row.value != null) values.set(row.key, row.value);
        }
        return values;
    }

    /** Upsert a value, or delete the key outright when passed `null`. */
    async set(key: string, value: string | null): Promise<void> {
        if (value === null) {
            await this.db.deleteFrom('deadair.settings').where('key', '=', key).execute();
            return;
        }

        await this.db
            .insertInto('deadair.settings')
            .values({ key, value })
            .onConflict(conflict => conflict.column('key').doUpdateSet({ value }))
            .execute();
    }
}
