import {
    PLUGIN_CAPABILITY_CATALOG,
    PLUGIN_CAPABILITY_ENRICHMENT,
    type EnrichmentPluginInstance,
    type MusicProviderPluginInstance,
    type PluginManifest,
} from '@deadair/plugin-sdk';
import type { PluginRecord } from './types/plugin.record.js';

/**
 * The catalog methods a plugin has to actually have before anything may call
 * one. `resolveStreamUrl` is deliberately absent: the SDK marks it optional for
 * "steer only" providers that play audio themselves and never hand out a URL.
 */
export const CATALOG_METHODS = ['listPlaylists', 'getPlaylistTracks'] as const satisfies ReadonlyArray<keyof MusicProviderPluginInstance>;

/**
 * A plugin narrowed to "catalog, right now": active, declaring the capability,
 * and carrying an instance that implements it.
 */
export interface CatalogPlugin {
    record: PluginRecord;
    manifest: PluginManifest;
    instance: MusicProviderPluginInstance;
}

/**
 * Whether a capability is genuinely available, as opposed to merely advertised.
 *
 * A manifest is a promise, and calling a method the plugin forgot to write is a
 * `TypeError` in the middle of a request rather than an honest "not supported".
 * So the declaration and the implementation are both required, and neither is
 * taken as evidence of the other.
 */
export const implementsCatalog = (manifest: PluginManifest | undefined, instance: unknown): boolean => {
    if (!manifest?.capabilities.includes(PLUGIN_CAPABILITY_CATALOG)) return false;
    return CATALOG_METHODS.every(method => typeof (instance as Record<string, unknown>)[method] === 'function');
};

/**
 * The catalog-capable view of a record, or `undefined` when it is not one.
 *
 * Shared so the two callers cannot drift: `PlaylistsService` asks per request
 * and the catalog sync asks per run, and a plugin that one of them considers
 * usable while the other does not is a bug that shows up as a half-populated
 * catalog rather than an error.
 *
 * Status is part of the question, not separate from it — a plugin can be
 * disabled, quarantined or mid-reinitialize at any moment, so "declares
 * catalog" and "can be called right now" are different claims. Callers that
 * must explain *why* a specific plugin was rejected (404 vs 501 vs 503) take
 * the pieces apart themselves; this is for callers that only need the ones that
 * work.
 */
export const asCatalogPlugin = (record: PluginRecord): CatalogPlugin | undefined => {
    if (record.status !== 'active' || !record.manifest || !record.instance) return undefined;
    if (!implementsCatalog(record.manifest, record.instance)) return undefined;
    return { record, manifest: record.manifest, instance: record.instance as MusicProviderPluginInstance };
};

/** The one method an enrichment plugin exists to provide. */
export const ENRICHMENT_METHODS = ['enrichTrack'] as const satisfies ReadonlyArray<keyof EnrichmentPluginInstance>;

/**
 * Where an enrichment plugin sorts when several answer for the same track, for
 * a plugin that declared the capability and then forgot to say. Mid-scale, per
 * the SDK's own guidance: not the canonical source, not a guess.
 */
export const DEFAULT_ENRICHMENT_PRIORITY = 500;

export interface EnrichmentPlugin {
    record: PluginRecord;
    manifest: PluginManifest;
    instance: EnrichmentPluginInstance;
    /** {@link EnrichmentPluginInstance.priority}, defaulted. Lower wins on merge. */
    priority: number;
}

/** The same declaration-and-implementation rule as {@link implementsCatalog}, for enrichment. */
export const implementsEnrichment = (manifest: PluginManifest | undefined, instance: unknown): boolean => {
    if (!manifest?.capabilities.includes(PLUGIN_CAPABILITY_ENRICHMENT)) return false;
    return ENRICHMENT_METHODS.every(method => typeof (instance as Record<string, unknown>)[method] === 'function');
};

/**
 * The enrichment-capable view of a record, or `undefined` when it is not one.
 *
 * The sibling of {@link asCatalogPlugin}, and it carries `priority` because
 * that number is the whole ordering: enrichment is a fan-out where several
 * plugins answer the same question and the merge has to know which answer to
 * believe. Reading it here rather than at each call site means one plugin
 * cannot sort differently for two callers.
 */
export const asEnrichmentPlugin = (record: PluginRecord): EnrichmentPlugin | undefined => {
    if (record.status !== 'active' || !record.manifest || !record.instance) return undefined;
    if (!implementsEnrichment(record.manifest, record.instance)) return undefined;

    const instance = record.instance as EnrichmentPluginInstance;
    const priority = typeof instance.priority === 'number' && Number.isFinite(instance.priority) ? instance.priority : DEFAULT_ENRICHMENT_PRIORITY;

    return { record, manifest: record.manifest, instance, priority };
};
