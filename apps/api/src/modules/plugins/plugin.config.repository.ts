import { Injectable } from 'injectkit';
import { sql, type RawBuilder } from 'kysely';
import { DateTime } from 'luxon';
import { DataRepository } from '../data/data.repository.js';
import { toJsonb } from '../data/jsonb.js';

type PluginLogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * A plugin's persisted configuration row.
 *
 * `secrets` holds ciphertext keyed by config-field key, never plaintext. Only
 * {@link PluginConfigService} may decrypt it; nothing that reaches an HTTP
 * response should ever carry this map.
 */
export interface PluginConfigRecord {
    pluginId: string;
    enabled: boolean;
    /** Plain (non-secret) config values, keyed by config-field key. */
    config: Record<string, unknown>;
    /** Per-field ciphertext, keyed by config-field key. */
    secrets: Record<string, string>;
    status?: string;
    lastError?: string;
    /** Per-plugin override of the log level. Absent means "use the store's default". */
    logLevel?: PluginLogLevel;
    /** When this plugin was first ever enabled. Absent means it never has been. */
    firstEnabledAt?: DateTime;
    createdAt: DateTime;
    updatedAt: DateTime;
}

/**
 * Fields to write. Anything left `undefined` is untouched by the upsert;
 * `null` explicitly clears `status` / `lastError` / `logLevel`.
 */
export interface PluginConfigPatch {
    enabled?: boolean;
    /** Sets `first_enabled_at` to now if it is not already set. Only an enable asks for it. */
    stampFirstEnabled?: boolean;
    config?: Record<string, unknown>;
    secrets?: Record<string, string>;
    status?: string | null;
    lastError?: string | null;
    logLevel?: PluginLogLevel;
}

export type PluginConfigUpsert = PluginConfigPatch & { pluginId: string };

type PluginConfigColumns = {
    enabled?: boolean;
    firstEnabledAt?: RawBuilder<DateTime>;
    config?: null;
    secrets?: null;
    status?: string | null;
    lastError?: string | null;
    logLevel?: PluginLogLevel;
};

@Injectable()
export class PluginConfigRepository extends DataRepository {
    /** Resolves to `undefined` when the plugin has never been configured. */
    async get(pluginId: string): Promise<PluginConfigRecord | undefined> {
        const row = await this.db.selectFrom('deadair.pluginConfigs').selectAll().where('pluginId', '=', pluginId).executeTakeFirst();
        return row ? this.toRecord(row) : undefined;
    }

    async list(): Promise<PluginConfigRecord[]> {
        const rows = await this.db.selectFrom('deadair.pluginConfigs').selectAll().orderBy('pluginId', 'asc').execute();
        return rows.map(row => this.toRecord(row));
    }

    /** Insert or merge a config row. Only the fields present on `row` are written. */
    async upsert(row: PluginConfigUpsert): Promise<PluginConfigRecord> {
        const { pluginId, ...patch } = row;
        const columns = this.toColumns(patch);

        // `first_enabled_at` is the one column whose two branches differ, and they have to. A new
        // row is being enabled for the first time by definition, so it takes `now()`; an existing
        // one must KEEP whatever it already had, which means reading the column being written.
        //
        // Two things about that read, both of which this got wrong once. Postgres allows it only in
        // the conflict branch: a bare column reference in `values` is "column does not exist", since
        // there is no row there yet to read from. And it has to be TABLE-QUALIFIED even there, or it
        // is "ambiguous" — inside `do update` the name could equally mean the row being proposed,
        // which is `excluded` and is exactly the value that must not win here.
        const onConflict =
            columns.firstEnabledAt === undefined
                ? columns
                : { ...columns, firstEnabledAt: sql<DateTime>`coalesce(deadair.plugin_configs.first_enabled_at, now())` };

        const inserted = await this.db
            .insertInto('deadair.pluginConfigs')
            .values({ pluginId, ...columns })
            .onConflict(oc =>
                // The conflict target is referenced unqualified by Postgres, so an
                // empty patch still needs a column to set: rewriting plugin_id to
                // itself keeps the RETURNING clause populated.
                oc.column('pluginId').doUpdateSet(Object.keys(onConflict).length > 0 ? onConflict : { pluginId }),
            )
            .returningAll()
            .executeTakeFirstOrThrow();
        return this.toRecord(inserted);
    }

    /**
     * Turns a plugin on or off, and remembers the FIRST time it was ever turned on.
     *
     * `coalesce` rather than a read-then-write, so the stamp cannot be moved by a second enable and
     * needs no round trip to find out whether there already was one. Disabling leaves it alone, and
     * deliberately: turning something off is not a statement that you never trusted it, so a plugin
     * re-enabled later is not asked to justify itself again.
     *
     * Written here rather than in the service because this is the one statement that sets `enabled`,
     * and a stamp applied one layer up would be a second writer of the same fact.
     */
    async setEnabled(pluginId: string, enabled: boolean): Promise<PluginConfigRecord> {
        return this.upsert({ pluginId, enabled, ...(enabled ? { stampFirstEnabled: true } : {}) });
    }

    /** Records a lifecycle status. An omitted `lastError` clears any previous error. */
    async setStatus(pluginId: string, status: string, lastError?: string): Promise<PluginConfigRecord> {
        return this.upsert({ pluginId, status, lastError: lastError ?? null });
    }

    /** Sets the per-plugin log level override. `null` clears it back to "use the default". */
    async setLogLevel(pluginId: string, level?: PluginLogLevel): Promise<PluginConfigRecord> {
        return this.upsert({ pluginId, logLevel: level });
    }

    private toColumns(patch: PluginConfigPatch): PluginConfigColumns {
        const columns: PluginConfigColumns = {};
        if (patch.enabled !== undefined) columns.enabled = patch.enabled;
        // Plain `now()` here, and see {@link upsert} for why the conflict branch cannot use it.
        if (patch.stampFirstEnabled === true) columns.firstEnabledAt = sql<DateTime>`now()`;
        if (patch.config !== undefined) columns.config = toJsonb(patch.config);
        if (patch.secrets !== undefined) columns.secrets = toJsonb(patch.secrets);
        if (patch.status !== undefined) columns.status = patch.status;
        if (patch.lastError !== undefined) columns.lastError = patch.lastError;
        if (patch.logLevel !== undefined) columns.logLevel = patch.logLevel;
        return columns;
    }

    private toRecord(row: {
        pluginId: string;
        enabled: boolean;
        config: unknown;
        secrets: unknown;
        status: string | null;
        lastError: string | null;
        logLevel: PluginLogLevel;
        firstEnabledAt: DateTime | null;
        createdAt: DateTime;
        updatedAt: DateTime;
    }): PluginConfigRecord {
        return {
            pluginId: row.pluginId,
            enabled: row.enabled,
            firstEnabledAt: row.firstEnabledAt ?? undefined,
            config: this.asRecord(row.config),
            secrets: this.asSecrets(row.secrets),
            status: row.status ?? undefined,
            lastError: row.lastError ?? undefined,
            logLevel: row.logLevel,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };
    }

    private asRecord(value: unknown): Record<string, unknown> {
        return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    }

    private asSecrets(value: unknown): Record<string, string> {
        const source = this.asRecord(value);
        const secrets: Record<string, string> = {};
        for (const [key, ciphertext] of Object.entries(source)) {
            if (typeof ciphertext === 'string') secrets[key] = ciphertext;
        }
        return secrets;
    }
}
