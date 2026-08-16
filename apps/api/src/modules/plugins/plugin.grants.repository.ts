import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { DataRepository } from '../data/data.repository.js';
import type { GrantDecision } from './plugin.grants.js';

/**
 * One answer an operator gave, as it is stored.
 *
 * There is no `pending` and no record of the ASK, because the manifest is the request: see the note
 * on `deadair.plugin_grants` in `0004_plugins.sql`. A plugin with no row here has not been answered,
 * which every reader treats as refused.
 */
export interface PluginGrantRecord {
    pluginId: string;
    capability: string;
    decision: GrantDecision;
    decidedAt: DateTime;
    /** The actor who decided, where one is still around. */
    decidedBy?: string;
}

@Injectable()
export class PluginGrantsRepository extends DataRepository {
    /**
     * Every decision on the station, oldest plugin first.
     *
     * The whole table, deliberately, and it is read at boot and after each write rather than per
     * question: this is a handful of rows describing what a handful of plugins may do, and the thing
     * asking is `PluginHostFactory` on every outbound fetch. See {@link PluginGrantsService}.
     */
    async list(): Promise<PluginGrantRecord[]> {
        const rows = await this.db.selectFrom('deadair.pluginGrants').selectAll().orderBy('pluginId', 'asc').orderBy('capability', 'asc').execute();

        return rows.map(row => this.toRecord(row));
    }

    /**
     * Records an answer, replacing whatever was there.
     *
     * `decidedAt` is written explicitly rather than left to its default, because the column is a
     * record of WHEN somebody decided and an upsert that only touched `updated_at` would leave a
     * reversal claiming the time of the original decision.
     */
    async decide(pluginId: string, capability: string, decision: GrantDecision, decidedBy?: string): Promise<PluginGrantRecord> {
        const values = { decision, decidedAt: DateTime.utc(), decidedBy: decidedBy ?? null };

        const row = await this.db
            .insertInto('deadair.pluginGrants')
            .values({ pluginId, capability, ...values })
            .onConflict(oc => oc.columns(['pluginId', 'capability']).doUpdateSet(values))
            .returningAll()
            .executeTakeFirstOrThrow();

        return this.toRecord(row);
    }

    /** Removes an answer. See {@link PluginGrantsService.forget} for why this is a delete. */
    async forget(pluginId: string, capability: string): Promise<void> {
        await this.db.deleteFrom('deadair.pluginGrants').where('pluginId', '=', pluginId).where('capability', '=', capability).execute();
    }

    private toRecord(row: {
        pluginId: string;
        capability: string;
        decision: string;
        decidedAt: DateTime;
        decidedBy: string | null;
    }): PluginGrantRecord {
        return {
            pluginId: row.pluginId,
            capability: row.capability,
            // The column is checked in the database, so anything else is a row somebody wrote by
            // hand. Reading it as a refusal is the safe direction.
            decision: row.decision === 'allowed' ? 'allowed' : 'denied',
            decidedAt: row.decidedAt,
            ...(row.decidedBy == null ? {} : { decidedBy: row.decidedBy }),
        };
    }
}
