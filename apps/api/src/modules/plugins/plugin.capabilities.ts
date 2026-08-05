import { PLUGIN_CAPABILITY_CATALOG, type MusicProviderPluginInstance, type PluginManifest } from '@deadair/plugin-sdk';
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
