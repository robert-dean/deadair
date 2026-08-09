import {
    PLUGIN_CAPABILITY_CATALOG,
    PLUGIN_CAPABILITY_ENRICHMENT,
    PLUGIN_CAPABILITY_LLM,
    PLUGIN_CAPABILITY_SPEECH,
    PLUGIN_CAPABILITY_STREAM,
    type EnrichmentPluginInstance,
    type LlmPluginInstance,
    type MusicProviderPluginInstance,
    type PluginManifest,
    type SpeechPluginInstance,
} from '@deadair/plugin-sdk';
import type { PluginRecord } from './types/plugin.record.js';

/** The catalog methods a plugin has to actually have before anything may call one. */
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

/**
 * The one method that earns the `stream` capability.
 *
 * One method rather than a family, because getting the station audio is one job
 * however the audio actually reaches the player: a Subsonic server mints a URL
 * itself, and Spotify's comes off the CDN encrypted so its plugin lends a login
 * to the shim beside Liquidsoap and gets a URL back from `host.trackFetcher`.
 * Both answer here. A plugin that cannot answer at all plays its own audio and
 * declares `steer` instead.
 */
export const STREAM_METHODS = ['resolveStreamUrl'] as const satisfies ReadonlyArray<keyof MusicProviderPluginInstance>;

/** A plugin narrowed to "can get us audio, right now". */
export interface StreamPlugin {
    record: PluginRecord;
    manifest: PluginManifest;
    instance: MusicProviderPluginInstance;
}

/** {@link implementsCatalog}'s rule, applied to the `stream` capability. */
export const implementsStream = (manifest: PluginManifest | undefined, instance: unknown): boolean => {
    if (!manifest?.capabilities.includes(PLUGIN_CAPABILITY_STREAM)) return false;
    return STREAM_METHODS.every(method => typeof (instance as Record<string, unknown>)[method] === 'function');
};

/** The stream-capable view of a record, or `undefined` when it is not one. */
export const asStreamPlugin = (record: PluginRecord): StreamPlugin | undefined => {
    if (record.status !== 'active' || !record.manifest || !record.instance) return undefined;
    if (!implementsStream(record.manifest, record.instance)) return undefined;
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
    /** Whether `enrichArtist` is there to call. Optional in the SDK, so absent is normal, not broken. */
    enrichesArtists: boolean;
    /** Whether `enrichAlbum` is there to call. */
    enrichesAlbums: boolean;
    /** Whether `enrichTracks` is there to call, i.e. whether this source can be asked in bulk. */
    enrichesBatches: boolean;
    /**
     * {@link EnrichmentPluginInstance.maxBatchSize}, defaulted and clamped.
     *
     * Read here rather than at the call site for the reason `priority` is: the
     * host does the chunking, so one plugin must not be chunked two ways by two
     * callers. Meaningless unless {@link enrichesBatches}.
     */
    maxBatchSize: number;
}

/**
 * How many refs a batch-capable plugin is handed when it names no number of its
 * own. Deliberately modest: it is the size of one upstream query for the sources
 * this exists for, and a plugin that can take more says so.
 */
export const DEFAULT_ENRICHMENT_BATCH_SIZE = 25;

/**
 * Above this, a batch call stops being a small fixed number of round trips and
 * starts being a walk with a deadline it cannot meet. A plugin asking for more
 * is clamped rather than refused: the number is an optimisation hint, and
 * getting it wrong should cost throughput, not the capability.
 */
export const MAX_ENRICHMENT_BATCH_SIZE = 100;

/**
 * Whether an instance answers about artists as well as recordings.
 *
 * Deliberately not part of {@link ENRICHMENT_METHODS}: `enrichArtist` is
 * optional in the SDK the way `resolveStreamUrl` is, so a source that only
 * knows recordings must stay a usable enrichment plugin rather than being
 * rejected for a method it was never required to write.
 */
export const implementsArtistEnrichment = (instance: unknown): boolean => typeof (instance as Record<string, unknown>).enrichArtist === 'function';

/** {@link implementsArtistEnrichment} for records. */
export const implementsAlbumEnrichment = (instance: unknown): boolean => typeof (instance as Record<string, unknown>).enrichAlbum === 'function';

/** {@link implementsArtistEnrichment} for the bulk form of the recording question. */
export const implementsBatchEnrichment = (instance: unknown): boolean => typeof (instance as Record<string, unknown>).enrichTracks === 'function';

/** {@link EnrichmentPluginInstance.maxBatchSize}, defaulted and held between 1 and the ceiling. */
export const enrichmentBatchSize = (instance: EnrichmentPluginInstance): number => {
    const declared = instance.maxBatchSize;
    if (typeof declared !== 'number' || !Number.isFinite(declared) || declared < 1) return DEFAULT_ENRICHMENT_BATCH_SIZE;
    return Math.min(Math.floor(declared), MAX_ENRICHMENT_BATCH_SIZE);
};

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

    return {
        record,
        manifest: record.manifest,
        instance,
        priority,
        enrichesArtists: implementsArtistEnrichment(instance),
        enrichesAlbums: implementsAlbumEnrichment(instance),
        enrichesBatches: implementsBatchEnrichment(instance),
        maxBatchSize: enrichmentBatchSize(instance),
    };
};

/**
 * The one method that earns the `speech` capability.
 *
 * It used to be three: `speak` handed back a handle and `readStream` /
 * `closeStream` drained it, so both had to be checked here or a plugin that
 * could start speaking and could not be drained would fail as a `TypeError`
 * half way through a render, with a segment already moved to `rendering`. The
 * audio is a `ReadableStream` now, so there is nothing left to forget.
 *
 * `listVoices` is deliberately absent. It is optional in the SDK the way
 * `enrichArtist` is, and a plugin with one voice is a legitimate thing to be.
 */
export const SPEECH_METHODS = ['speak'] as const satisfies ReadonlyArray<keyof SpeechPluginInstance>;

/** A plugin narrowed to "can say something, right now". */
export interface SpeechPlugin {
    record: PluginRecord;
    manifest: PluginManifest;
    instance: SpeechPluginInstance;
    /** Whether `listVoices` is there to call. Optional in the SDK, so absent is normal, not broken. */
    listsVoices: boolean;
}

/** {@link implementsCatalog}'s rule, applied to the `speech` capability. */
export const implementsSpeech = (manifest: PluginManifest | undefined, instance: unknown): boolean => {
    if (!manifest?.capabilities.includes(PLUGIN_CAPABILITY_SPEECH)) return false;
    return SPEECH_METHODS.every(method => typeof (instance as Record<string, unknown>)[method] === 'function');
};

/** Whether this plugin can describe the voices it offers, for a console that has to draw a list. */
export const implementsVoiceListing = (instance: unknown): boolean => typeof (instance as Record<string, unknown>).listVoices === 'function';

/**
 * The speech-capable view of a record, or `undefined` when it is not one.
 *
 * Unlike enrichment, which fans out to every plugin that answers, speech has
 * exactly one speaker at a time: two voices rendering the same break is not a
 * merge, it is two breaks. So there is no priority here, and choosing between
 * several is a setting rather than an ordering — see `render.speechPluginId`.
 */
export const asSpeechPlugin = (record: PluginRecord): SpeechPlugin | undefined => {
    if (record.status !== 'active' || !record.manifest || !record.instance) return undefined;
    if (!implementsSpeech(record.manifest, record.instance)) return undefined;

    const instance = record.instance as SpeechPluginInstance;
    return { record, manifest: record.manifest, instance, listsVoices: implementsVoiceListing(instance) };
};

/**
 * The one method that earns the `llm` capability.
 *
 * `listModels` is not on the list, the way `listVoices` is not on the speech
 * one: it is optional in the SDK and a plugin without it still produces words.
 * What it costs is tools, and that is a degraded answer rather than a broken
 * plugin — see {@link LlmPlugin.listsModels}.
 */
export const LLM_METHODS = ['generate'] as const satisfies ReadonlyArray<keyof LlmPluginInstance>;

/** A plugin narrowed to "can produce words, right now". */
export interface LlmPlugin {
    record: PluginRecord;
    manifest: PluginManifest;
    instance: LlmPluginInstance;
    /**
     * Whether `listModels` is there to call.
     *
     * Load-bearing in a way `listsVoices` is not. Tool support is a property of
     * the MODEL rather than the server, so this is the only way the host can
     * learn that any model here can be given tools. A plugin without it gets no
     * tools, which is a correct answer written without facts rather than a
     * failure — and it is why a plugin that wants tool calling has to describe
     * itself.
     */
    listsModels: boolean;
}

/** {@link implementsCatalog}'s rule, applied to the `llm` capability. */
export const implementsLlm = (manifest: PluginManifest | undefined, instance: unknown): boolean => {
    if (!manifest?.capabilities.includes(PLUGIN_CAPABILITY_LLM)) return false;
    return LLM_METHODS.every(method => typeof (instance as Record<string, unknown>)[method] === 'function');
};

/** Whether this plugin can describe its models, which is also whether it can ever be given tools. */
export const implementsModelListing = (instance: unknown): boolean => typeof (instance as Record<string, unknown>).listModels === 'function';

/**
 * The llm-capable view of a record, or `undefined` when it is not one.
 *
 * No priority, for the same reason `asSpeechPlugin` has none: this is a
 * capability with one answer rather than a fan-out. Two models writing the same
 * line is not a merge, it is one generation paid for twice, so choosing between
 * several installed plugins is a setting — see `llm.pluginId`.
 */
export const asLlmPlugin = (record: PluginRecord): LlmPlugin | undefined => {
    if (record.status !== 'active' || !record.manifest || !record.instance) return undefined;
    if (!implementsLlm(record.manifest, record.instance)) return undefined;

    const instance = record.instance as LlmPluginInstance;
    return { record, manifest: record.manifest, instance, listsModels: implementsModelListing(instance) };
};
