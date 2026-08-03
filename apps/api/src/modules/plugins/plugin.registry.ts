import { Injectable } from 'injectkit';
import type { PluginInstance } from '@deadair/plugin-sdk';
import type { PluginRecord, PluginStatus } from './types/plugin.record.js';

/** Narrowing options for {@link PluginRegistry.list}. */
export interface PluginListFilter {
    kind?: string;
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

    /**
     * Replaces the whole catalogue, typically with a fresh `discover()` result.
     * First record wins on a duplicate id, matching the loader's rule, so a
     * quarantined duplicate can never displace the plugin that claimed the id.
     */
    setAll(records: readonly PluginRecord[]): void {
        this.records.clear();
        for (const record of records) {
            if (this.records.has(record.id)) continue;
            this.records.set(record.id, record);
        }
    }

    /** Adds or replaces one record outright. */
    upsert(record: PluginRecord): void {
        this.records.set(record.id, record);
    }

    /** Drops a record. Returns whether there was one to drop. */
    remove(id: string): boolean {
        return this.records.delete(id);
    }

    /** Every record, optionally narrowed to one plugin kind. Insertion ordered. */
    list(filter?: PluginListFilter): PluginRecord[] {
        const records = [...this.records.values()];
        if (filter?.kind === undefined) return records;
        return records.filter(record => record.manifest?.kind === filter.kind);
    }

    get(id: string): PluginRecord | undefined {
        return this.records.get(id);
    }

    /** The live instance of a plugin, present only while it is `active`. */
    instance(id: string): PluginInstance | undefined {
        return this.records.get(id)?.instance;
    }

    /**
     * Active plugins of `kind` that declare `capability` in their manifest.
     *
     * Filtering on `active` rather than on the manifest alone is the point: a
     * declared capability is only a promise, and callers of this method are
     * about to invoke the instance. A disabled, misconfigured, or quarantined
     * plugin has no instance to invoke.
     */
    byCapability(kind: string, capability: string): PluginRecord[] {
        return [...this.records.values()].filter(
            record => record.status === 'active' && record.manifest?.kind === kind && record.manifest.capabilities.includes(capability),
        );
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
