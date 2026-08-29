import type { ChartsProvider } from './capabilities/charts.js';
import type { EnrichmentProvider } from './capabilities/enrichment.js';
import type { MusicProviderCatalog, MusicProviderOAuth, MusicProviderSteer, MusicProviderStream } from './capabilities/music.provider.js';
import type { NewsProvider } from './capabilities/news.js';
import type { ScrobbleProvider } from './capabilities/scrobble.js';
import type { SearchProvider } from './capabilities/search.js';
import type { SimilarityProvider } from './capabilities/similarity.js';
import type { WeatherProvider } from './capabilities/weather.js';
import type { PluginManifest } from './plugin.manifest.js';
import type { PluginLifecycle } from './plugin.lifecycle.js';

/**
 * A plugin instance: the lifecycle, plus whatever capability interfaces the
 * plugin declared in `manifest.capabilities`.
 */
export type PluginInstance = PluginLifecycle;

/**
 * Builds a fresh plugin instance. The host calls this once per configured
 * installation, then calls `init(host)` on the result. Do no I/O here: keep
 * the constructor cheap and put setup in `init`.
 */
export type PluginFactory<TInstance extends PluginInstance = PluginInstance> = () => TInstance;

/** What a plugin package default-exports. */
export interface DeadairPlugin<TInstance extends PluginInstance = PluginInstance> {
    manifest: PluginManifest;
    factory: PluginFactory<TInstance>;
}

/**
 * Instance shape for a `music-provider` plugin. Every capability method is
 * optional: implement the subset you declared in `manifest.capabilities`.
 */
export type MusicProviderPluginInstance = PluginLifecycle &
    Partial<MusicProviderCatalog> &
    Partial<MusicProviderStream> &
    Partial<MusicProviderSteer> &
    Partial<MusicProviderOAuth>;

/** Instance shape for an `enrichment` plugin. */
export type EnrichmentPluginInstance = PluginLifecycle & EnrichmentProvider;

/** Instance shape for a `charts` plugin. */
export type ChartsPluginInstance = PluginLifecycle & ChartsProvider;

/** Instance shape for a `news` plugin. */
export type NewsPluginInstance = PluginLifecycle & NewsProvider;

/** Instance shape for a `similarity` plugin. */
export type SimilarityPluginInstance = PluginLifecycle & SimilarityProvider;

/** Instance shape for a `search` plugin. */
export type SearchPluginInstance = PluginLifecycle & SearchProvider;

/** Instance shape for a `weather` plugin. */
export type WeatherPluginInstance = PluginLifecycle & WeatherProvider;

/** Instance shape for a `scrobble` plugin. */
export type ScrobblePluginInstance = PluginLifecycle & ScrobbleProvider;

/**
 * Pairs a manifest with its factory and returns the object a plugin package
 * default-exports. Purely a typing helper: it does no validation, because the
 * host validates the manifest with `pluginManifestSchema` at load time.
 *
 * ```ts
 * export default definePlugin(manifest, () => new MyPlugin());
 * ```
 */
export function definePlugin<TInstance extends PluginInstance>(
    manifest: PluginManifest,
    factory: PluginFactory<TInstance>,
): DeadairPlugin<TInstance> {
    return { manifest, factory };
}
