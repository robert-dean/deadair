import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { DataRepository } from '../data/data.repository.js';

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
    createdAt: DateTime;
    updatedAt: DateTime;
}

/**
 * Fields to write. Anything left `undefined` is untouched by the upsert;
 * `null` explicitly clears `status` / `lastError` / `logLevel`.
 */
export interface PluginConfigPatch {
    enabled?: boolean;
    config?: Record<string, unknown>;
    secrets?: Record<string, string>;
    status?: string | null;
    lastError?: string | null;
    logLevel?: PluginLogLevel;
}

export type PluginConfigUpsert = PluginConfigPatch & { pluginId: string };

type PluginConfigColumns = {
    enabled?: boolean;
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
        const inserted = await this.db
            .insertInto('deadair.pluginConfigs')
            .values({ pluginId, ...columns })
            .onConflict(oc =>
                // The conflict target is referenced unqualified by Postgres, so an
                // empty patch still needs a column to set: rewriting plugin_id to
                // itself keeps the RETURNING clause populated.
                oc.column('pluginId').doUpdateSet(Object.keys(columns).length > 0 ? columns : { pluginId }),
            )
            .returningAll()
            .executeTakeFirstOrThrow();
        return this.toRecord(inserted);
    }

    async setEnabled(pluginId: string, enabled: boolean): Promise<PluginConfigRecord> {
        return this.upsert({ pluginId, enabled });
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
        if (patch.config !== undefined) columns.config = this.toJsonb(patch.config);
        if (patch.secrets !== undefined) columns.secrets = this.toJsonb(patch.secrets);
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
        createdAt: DateTime;
        updatedAt: DateTime;
    }): PluginConfigRecord {
        return {
            pluginId: row.pluginId,
            enabled: row.enabled,
            config: this.asRecord(row.config),
            secrets: this.asSecrets(row.secrets),
            status: row.status ?? undefined,
            lastError: row.lastError ?? undefined,
            logLevel: row.logLevel,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };
    }

    /** jsonb columns are typed as `Json` by kysely-codegen; pg wants the serialized form. */
    private toJsonb(value: unknown): null {
        return JSON.stringify(value) as unknown as null;
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
