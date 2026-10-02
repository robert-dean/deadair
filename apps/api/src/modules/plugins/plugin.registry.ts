import { Injectable } from 'injectkit';
import type { PluginInstance } from '@deadair/plugin-sdk';
import type { PluginRecord, PluginStatus } from './types/plugin.record.js';

/**
 * Collapses a discovery result to one record per id, keyed by id, first record
 * wins. This is the loader's own duplicate rule: the copy that claimed an id
 * keeps it, and every later claimant comes back quarantined, so a quarantined
 * duplicate must never displace the copy it lost to.
 *
 * Exported so every consumer of a `discover()` result applies the same rule.
 */
export function firstWinsById(records: readonly PluginRecord[]): Map<string, PluginRecord> {
    const byId = new Map<string, PluginRecord>();
    for (const record of records) {
        if (byId.has(record.id)) continue;
        byId.set(record.id, record);
    }
    return byId;
}

/**
 * The installed copies in a discovery result that lost their id to a BUNDLED plugin, keyed by id.
 *
 * {@link firstWinsById} drops every losing copy, which is right for the catalogue and left these with
 * no way out: the catalogue answers with the bundled record for the id, so removing "that plugin"
 * meant the bundled one and was refused. They are the copies an operator imported before the
 * station started shipping the plugin, and they are what `PluginInstallService.removePlugin` deletes
 * when it is asked to remove a bundled id. Other losers (two installed copies of one id, say) are not
 * collected: removing by id already reaches the folder that won, and the loser beside it is a
 * different question.
 */
export function bundledShadows(records: readonly PluginRecord[]): Map<string, PluginRecord[]> {
    const winners = firstWinsById(records);
    const shadows = new Map<string, PluginRecord[]>();
    for (const record of records) {
        const winner = winners.get(record.id);
        if (winner === undefined || winner === record) continue;
        if (winner.origin !== 'bundled' || record.origin !== 'installed') continue;
        shadows.set(record.id, [...(shadows.get(record.id) ?? []), record]);
    }
    return shadows;
}

/**
 * The in-memory catalogue of everything the host knows about plugins: one
 * record per plugin id, its current status, and its live instance once the
 * lifecycle manager has initialized it.
 *
 * Pure bookkeeping. The registry never imports, instantiates, or calls plugin
 * code; the loader does the importing and the lifecycle manager does the
 * calling, so this stays a synchronous, side-effect-free map that anything can
 * read without risk.
 */
@Injectable()
export class PluginRegistry {
    private readonly records = new Map<string, PluginRecord>();
    private shadows = new Map<string, PluginRecord[]>();

    /**
     * Replaces the whole catalogue, typically with a fresh `discover()` result.
     * First record wins on a duplicate id, matching the loader's rule, so a
     * quarantined duplicate can never displace the plugin that claimed the id.
     */
    setAll(records: readonly PluginRecord[]): void {
        this.records.clear();
        for (const [id, record] of firstWinsById(records)) {
            this.records.set(id, record);
        }
        this.setShadowed(records);
    }

    /**
     * Records which installed copies in a discovery result are shadowed by a bundled plugin
     * ({@link bundledShadows}). `setAll` does this itself; a rescan, which upserts rather than
     * replacing the catalogue, calls it with the same result.
     */
    setShadowed(records: readonly PluginRecord[]): void {
        this.shadows = bundledShadows(records);
    }

    /** The installed copies of `id` that never load because the station bundles that plugin. */
    shadowedCopies(id: string): PluginRecord[] {
        return this.shadows.get(id) ?? [];
    }

    /** Adds or replaces one record outright. */
    upsert(record: PluginRecord): void {
        this.records.set(record.id, record);
    }

    /** Drops a record. Returns whether there was one to drop. */
    remove(id: string): boolean {
        return this.records.delete(id);
    }

    /** Every record, insertion ordered. Narrowing is the caller's job, and it is always by capability. */
    list(): PluginRecord[] {
        return [...this.records.values()];
    }

    get(id: string): PluginRecord | undefined {
        return this.records.get(id);
    }

    /** The live instance of a plugin, present only while it is `active`. */
    instance(id: string): PluginInstance | undefined {
        return this.records.get(id)?.instance;
    }

    /**
     * Moves a plugin to a new status. Passing no `error` clears any previous
     * error text, so a plugin that recovers does not keep advertising a stale
     * failure.
     */
    setStatus(id: string, status: PluginStatus, error?: string): void {
        const record = this.records.get(id);
        if (!record) return;
        record.status = status;
        record.error = error;
    }
}
