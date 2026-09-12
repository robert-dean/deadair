import {
    PLUGIN_CAPABILITY_ANALYSIS,
    PLUGIN_CAPABILITY_CATALOG,
    PLUGIN_CAPABILITY_CHARTS,
    PLUGIN_CAPABILITY_ENRICHMENT,
    PLUGIN_CAPABILITY_LLM,
    PLUGIN_CAPABILITY_MIXER,
    PLUGIN_CAPABILITY_NEWS,
    PLUGIN_CAPABILITY_SCROBBLE,
    PLUGIN_CAPABILITY_SEARCH,
    PLUGIN_CAPABILITY_SIMILARITY,
    PLUGIN_CAPABILITY_SPEECH,
    PLUGIN_CAPABILITY_STREAM,
    PLUGIN_CAPABILITY_WEATHER,
    type AnalysisProvider,
    type ChartsPluginInstance,
    type ScrobblePluginInstance,
    type SimilarityPluginInstance,
    type EnrichmentPluginInstance,
    type LlmPluginInstance,
    type MixerProvider,
    type MusicProviderPluginInstance,
    type NewsPluginInstance,
    type PluginManifest,
    type SearchPluginInstance,
    type SpeechPluginInstance,
    type WeatherPluginInstance,
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
    /**
     * Whether `searchTracks` is there to call.
     *
     * Deliberately not part of {@link CATALOG_METHODS}: every catalog method is optional in the
     * SDK, and a provider that lists playlists and cannot be searched is a legitimate thing to be.
     * Reported here so a caller that needs searching can skip the ones that do not, the way
     * {@link EnrichmentPlugin.enrichesArtists} works.
     */
    searchesTracks: boolean;
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

    const instance = record.instance as MusicProviderPluginInstance;
    return { record, manifest: record.manifest, instance, searchesTracks: implementsTrackSearch(instance) };
};

/** Whether this plugin can be asked for a track by name, as opposed to only browsed. */
export const implementsTrackSearch = (instance: unknown): boolean => typeof (instance as Record<string, unknown>).searchTracks === 'function';

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
 * Both methods earn the `charts` capability, unlike every other family here
 * where one is required and the rest are optional.
 *
 * The reason is that neither is usable alone: a plugin that can fetch a chart
 * and cannot say which charts it has is unreachable, because a chart id is
 * scoped to the plugin that minted it and nothing else can invent one. And a
 * plugin that lists charts it cannot fetch is a menu with no kitchen.
 */
export const CHARTS_METHODS = ['listCharts', 'fetchChart'] as const satisfies ReadonlyArray<keyof ChartsPluginInstance>;

/** A plugin narrowed to "can say what is popular, right now". */
export interface ChartsPlugin {
    record: PluginRecord;
    manifest: PluginManifest;
    instance: ChartsPluginInstance;
}

/** {@link implementsCatalog}'s rule, applied to the `charts` capability. */
export const implementsCharts = (manifest: PluginManifest | undefined, instance: unknown): boolean => {
    if (!manifest?.capabilities.includes(PLUGIN_CAPABILITY_CHARTS)) return false;
    return CHARTS_METHODS.every(method => typeof (instance as Record<string, unknown>)[method] === 'function');
};

/**
 * The charts-capable view of a record, or `undefined` when it is not one.
 *
 * No `priority`, and the reason is not the one `asSpeechPlugin` gives. Speech
 * has one answer because two voices reading one break is two breaks; charts can
 * have many answers at once and they are still not a merge — two services'
 * top forties are two documents, and averaging them would produce a chart
 * nobody published. So several chart plugins are several MENUS, ordered by
 * nothing, and choosing between them is the operator picking an id.
 */
export const asChartsPlugin = (record: PluginRecord): ChartsPlugin | undefined => {
    if (record.status !== 'active' || !record.manifest || !record.instance) return undefined;
    if (!implementsCharts(record.manifest, record.instance)) return undefined;

    return { record, manifest: record.manifest, instance: record.instance as ChartsPluginInstance };
};

/**
 * Both methods earn the `news` capability, on {@link CHARTS_METHODS}'s argument
 * exactly: a feed id is scoped to the plugin that minted it, so a plugin that
 * fetches without listing is unreachable and one that lists without fetching is
 * a menu with no kitchen.
 */
export const NEWS_METHODS = ['listFeeds', 'fetchItems'] as const satisfies ReadonlyArray<keyof NewsPluginInstance>;

/** A plugin narrowed to "can say what happened outside the station". */
export interface NewsPlugin {
    record: PluginRecord;
    manifest: PluginManifest;
    instance: NewsPluginInstance;
}

/** {@link implementsCatalog}'s rule, applied to the `news` capability. */
export const implementsNews = (manifest: PluginManifest | undefined, instance: unknown): boolean => {
    if (!manifest?.capabilities.includes(PLUGIN_CAPABILITY_NEWS)) return false;
    return NEWS_METHODS.every(method => typeof (instance as Record<string, unknown>)[method] === 'function');
};

/**
 * The news-capable view of a record, or `undefined` when it is not one.
 *
 * No `priority`, for {@link asChartsPlugin}'s reason rather than
 * {@link asSpeechPlugin}'s: two news services are two newsrooms, and ranking
 * them would be the host deciding which account of an event is the true one.
 */
export const asNewsPlugin = (record: PluginRecord): NewsPlugin | undefined => {
    if (record.status !== 'active' || !record.manifest || !record.instance) return undefined;
    if (!implementsNews(record.manifest, record.instance)) return undefined;

    return { record, manifest: record.manifest, instance: record.instance as NewsPluginInstance };
};

/** The one method that earns the `search` capability. */
export const SEARCH_METHODS = ['search'] as const satisfies ReadonlyArray<keyof SearchPluginInstance>;

/** A plugin narrowed to "can ask the open web a question". */
export interface SearchPlugin {
    record: PluginRecord;
    manifest: PluginManifest;
    instance: SearchPluginInstance;
}

/** {@link implementsCatalog}'s rule, applied to the `search` capability. */
export const implementsSearch = (manifest: PluginManifest | undefined, instance: unknown): boolean => {
    if (!manifest?.capabilities.includes(PLUGIN_CAPABILITY_SEARCH)) return false;
    return SEARCH_METHODS.every(method => typeof (instance as Record<string, unknown>)[method] === 'function');
};

/**
 * The search-capable view of a record, or `undefined` when it is not one.
 *
 * No `priority`, for {@link asNewsPlugin}'s reason taken one step further: two
 * engines asked the same question return overlapping pages rather than rival
 * accounts, so the answers combine — but nothing here ranks one engine's page
 * above another's, because a relevance score is computed against an index this
 * host cannot see.
 */
export const asSearchPlugin = (record: PluginRecord): SearchPlugin | undefined => {
    if (record.status !== 'active' || !record.manifest || !record.instance) return undefined;
    if (!implementsSearch(record.manifest, record.instance)) return undefined;

    return { record, manifest: record.manifest, instance: record.instance as SearchPluginInstance };
};

/** The one method that earns the `weather` capability. */
export const WEATHER_METHODS = ['getWeather'] as const satisfies ReadonlyArray<keyof WeatherPluginInstance>;

/** A plugin narrowed to "can say what it is like outside". */
export interface WeatherPlugin {
    record: PluginRecord;
    manifest: PluginManifest;
    instance: WeatherPluginInstance;
}

/** {@link implementsCatalog}'s rule, applied to the `weather` capability. */
export const implementsWeather = (manifest: PluginManifest | undefined, instance: unknown): boolean => {
    if (!manifest?.capabilities.includes(PLUGIN_CAPABILITY_WEATHER)) return false;
    return WEATHER_METHODS.every(method => typeof (instance as Record<string, unknown>)[method] === 'function');
};

/**
 * The weather-capable view of a record, or `undefined` when it is not one.
 *
 * No `priority`, and unlike {@link asSearchPlugin} the answers do not combine
 * either: two services asked what it is like in one place give two readings of
 * the same sky, and a station that averaged them would be reporting a
 * temperature nobody measured. So `WeatherService` asks the first that answers
 * and stops, which is the arrangement {@link asSpeechPlugin} has for a different
 * reason — there because only one engine can speak a line, here because only one
 * of two disagreeing readings can be true.
 */
export const asWeatherPlugin = (record: PluginRecord): WeatherPlugin | undefined => {
    if (record.status !== 'active' || !record.manifest || !record.instance) return undefined;
    if (!implementsWeather(record.manifest, record.instance)) return undefined;

    return { record, manifest: record.manifest, instance: record.instance as WeatherPluginInstance };
};

/** The one method that earns the `scrobble` capability. */
export const SCROBBLE_METHODS = ['scrobble'] as const satisfies ReadonlyArray<keyof ScrobblePluginInstance>;

/**
 * How many plays a destination is handed at once when it names no number.
 *
 * Modest, because this is the size of one request to somebody else's service and
 * the queue drains on a two-minute cron: a station airing fifteen records an hour
 * never has a backlog this does not clear in one pass, and a service with a
 * smaller published limit says so.
 */
export const DEFAULT_SCROBBLE_BATCH_SIZE = 20;

/** Above this, one failure costs too many plays a retry. A plugin asking for more is clamped. */
export const MAX_SCROBBLE_BATCH_SIZE = 50;

/** A plugin narrowed to "can report what the station played, right now". */
export interface ScrobblePlugin {
    record: PluginRecord;
    manifest: PluginManifest;
    instance: ScrobblePluginInstance;
    /** Whether `nowPlaying` is there to call. Optional in the SDK, so absent is normal. */
    saysNowPlaying: boolean;
    /** Whether `accepting` is there to ask. Absent means yes, per the SDK. */
    declarable: boolean;
    /** {@link ScrobbleProvider.maxBatchSize}, defaulted and clamped. */
    maxBatchSize: number;
}

/** {@link implementsCatalog}'s rule, applied to the `scrobble` capability. */
export const implementsScrobble = (manifest: PluginManifest | undefined, instance: unknown): boolean => {
    if (!manifest?.capabilities.includes(PLUGIN_CAPABILITY_SCROBBLE)) return false;
    return SCROBBLE_METHODS.every(method => typeof (instance as Record<string, unknown>)[method] === 'function');
};

/** Whether this plugin wants telling what is on air, as opposed to only what has played. */
export const implementsNowPlaying = (instance: unknown): boolean => typeof (instance as Record<string, unknown>).nowPlaying === 'function';

/** Whether this plugin can be asked to decline. Absent means it always accepts, per the SDK. */
export const implementsAccepting = (instance: unknown): boolean => typeof (instance as Record<string, unknown>).accepting === 'function';

/** {@link ScrobbleProvider.maxBatchSize}, defaulted and held between 1 and the ceiling. */
export const scrobbleBatchSize = (instance: ScrobblePluginInstance): number => {
    const declared = instance.maxBatchSize;
    if (typeof declared !== 'number' || !Number.isFinite(declared) || declared < 1) return DEFAULT_SCROBBLE_BATCH_SIZE;
    return Math.min(Math.floor(declared), MAX_SCROBBLE_BATCH_SIZE);
};

/**
 * The scrobble-capable view of a record, or `undefined` when it is not one.
 *
 * No priority and no choosing between them, unlike speech or llm: every
 * destination gets every play, because two services scrobbling the same station
 * are two accounts an operator holds rather than two answers to one question.
 * That is also why the queue carries a row per play per destination — one
 * outage must not cost the other its retry.
 */
export const asScrobblePlugin = (record: PluginRecord): ScrobblePlugin | undefined => {
    if (record.status !== 'active' || !record.manifest || !record.instance) return undefined;
    if (!implementsScrobble(record.manifest, record.instance)) return undefined;

    const instance = record.instance as ScrobblePluginInstance;
    return {
        record,
        manifest: record.manifest,
        instance,
        saysNowPlaying: implementsNowPlaying(instance),
        declarable: implementsAccepting(instance),
        maxBatchSize: scrobbleBatchSize(instance),
    };
};

/**
 * The one method that earns the `similarity` capability.
 *
 * `artistTopTracks` is deliberately not on the list, the way `enrichArtist` is
 * not on enrichment's: a source that can only say who sounds alike is a
 * legitimate plugin, and one that can also name records is a better one.
 * {@link SimilarityPlugin.namesTracks} is how a caller that needs the second
 * skips the ones that only do the first.
 */
export const SIMILARITY_METHODS = ['similarArtists'] as const satisfies ReadonlyArray<keyof SimilarityPluginInstance>;

/** A plugin narrowed to "can say who else sounds like this, right now". */
export interface SimilarityPlugin {
    record: PluginRecord;
    manifest: PluginManifest;
    instance: SimilarityPluginInstance;
    /**
     * Whether `artistTopTracks` is there to call.
     *
     * Load-bearing in the way `LlmPlugin.listsModels` is rather than the way
     * `SpeechPlugin.listsVoices` is: without it the host has a list of names and
     * no way to turn one into a record, so such a plugin can inform a DJ and
     * cannot programme an hour.
     */
    namesTracks: boolean;
}

/** {@link implementsCatalog}'s rule, applied to the `similarity` capability. */
export const implementsSimilarity = (manifest: PluginManifest | undefined, instance: unknown): boolean => {
    if (!manifest?.capabilities.includes(PLUGIN_CAPABILITY_SIMILARITY)) return false;
    return SIMILARITY_METHODS.every(method => typeof (instance as Record<string, unknown>)[method] === 'function');
};

/** Whether this plugin can name records by an artist, as opposed to only naming the artist. */
export const implementsArtistTopTracks = (instance: unknown): boolean => typeof (instance as Record<string, unknown>).artistTopTracks === 'function';

/**
 * The similarity-capable view of a record, or `undefined` when it is not one.
 *
 * No `priority`, unlike enrichment, and the reason is what a disagreement means.
 * Two enrichment sources describing one record are reconciled because there is
 * one right answer about a release year. Two sources saying different artists
 * resemble Portishead are not in conflict at all — they are two opinions, and
 * the useful thing to do with both is to take both. So the host merges by name
 * without ranking the sources, and `match` orders within one source's answer
 * rather than across them.
 */
export const asSimilarityPlugin = (record: PluginRecord): SimilarityPlugin | undefined => {
    if (record.status !== 'active' || !record.manifest || !record.instance) return undefined;
    if (!implementsSimilarity(record.manifest, record.instance)) return undefined;

    const instance = record.instance as SimilarityPluginInstance;
    return { record, manifest: record.manifest, instance, namesTracks: implementsArtistTopTracks(instance) };
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
    /**
     * Whether `listCues` is there to call.
     *
     * A flag about the METHOD only. Whether the engine can actually perform a cue today is a
     * question for the method itself, because on at least one engine it depends on which model is
     * loaded — so a plugin that answers here can still answer with nothing, and that is not a fault.
     */
    listsCues: boolean;
    /** Whether `listDeliveries` is there to call. {@link listsCues}' rule exactly: about the method, not the engine. */
    listsDeliveries: boolean;
}

/** {@link implementsCatalog}'s rule, applied to the `speech` capability. */
export const implementsSpeech = (manifest: PluginManifest | undefined, instance: unknown): boolean => {
    if (!manifest?.capabilities.includes(PLUGIN_CAPABILITY_SPEECH)) return false;
    return SPEECH_METHODS.every(method => typeof (instance as Record<string, unknown>)[method] === 'function');
};

/** Whether this plugin can describe the voices it offers, for a console that has to draw a list. */
export const implementsVoiceListing = (instance: unknown): boolean => typeof (instance as Record<string, unknown>).listVoices === 'function';

/** Whether this plugin can say which performance cues it does. Absent means none, which is the safe default. */
export const implementsCueListing = (instance: unknown): boolean => typeof (instance as Record<string, unknown>).listCues === 'function';

/** Whether this plugin can say which deliveries it performs. Absent means none, the same safe default as cues. */
export const implementsDeliveryListing = (instance: unknown): boolean => typeof (instance as Record<string, unknown>).listDeliveries === 'function';

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
    return {
        record,
        manifest: record.manifest,
        instance,
        listsVoices: implementsVoiceListing(instance),
        listsCues: implementsCueListing(instance),
        listsDeliveries: implementsDeliveryListing(instance),
    };
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

/**
 * The one method that earns the `analysis` capability.
 *
 * One REQUIRED, because there is nothing a measurement can partially support: a
 * plugin either answers about a track's audio or it is not an analyzer.
 *
 * Joining audio was briefly an optional sibling here, asked for at the point of
 * use by a `canJoinAudio` that has gone with it. It is {@link MIXER_METHODS} now:
 * the method was reachable only through the analysis PICK, so the station's
 * joiner was whichever plugin the operator chose to measure with.
 */
export const ANALYSIS_METHODS = ['analyzeTrack'] as const satisfies ReadonlyArray<keyof AnalysisProvider>;

/** A plugin narrowed to "can measure a track's audio, right now". */
export interface AnalysisPlugin {
    record: PluginRecord;
    manifest: PluginManifest;
    instance: AnalysisProvider;
}

/** {@link implementsCatalog}'s rule, applied to the `analysis` capability. */
export const implementsAnalysis = (manifest: PluginManifest | undefined, instance: unknown): boolean => {
    if (!manifest?.capabilities.includes(PLUGIN_CAPABILITY_ANALYSIS)) return false;
    return ANALYSIS_METHODS.every(method => typeof (instance as Record<string, unknown>)[method] === 'function');
};

/**
 * The analysis-capable view of a record, or `undefined` when it is not one.
 *
 * No priority, for the reason `asSpeechPlugin` and `asLlmPlugin` have none, and
 * here the reason is the strongest of the three: two analyzers measuring the
 * same record do not produce something to merge, they produce two claims about
 * one physical fact, and the right response to a disagreement is to pick an
 * analyzer rather than to average them. So choosing between several installed
 * plugins is a setting — see `analysis.pluginId`.
 */
export const asAnalysisPlugin = (record: PluginRecord): AnalysisPlugin | undefined => {
    if (record.status !== 'active' || !record.manifest || !record.instance) return undefined;
    if (!implementsAnalysis(record.manifest, record.instance)) return undefined;

    return { record, manifest: record.manifest, instance: record.instance as AnalysisProvider };
};

/**
 * The one method that earns the `mixer` capability.
 *
 * Required rather than optional, which is the whole difference between this and
 * the `joinAudio` it replaced: that one was optional because it hung off a
 * capability meaning something else, and a plugin declaring THIS one and unable
 * to join is not a state worth being able to express.
 */
export const MIXER_METHODS = ['join'] as const satisfies ReadonlyArray<keyof MixerProvider>;

/** A plugin narrowed to "can make one piece of audio out of several, right now". */
export interface MixerPlugin {
    record: PluginRecord;
    manifest: PluginManifest;
    instance: MixerProvider;
}

/** {@link implementsCatalog}'s rule, applied to the `mixer` capability. */
export const implementsMixer = (manifest: PluginManifest | undefined, instance: unknown): boolean => {
    if (!manifest?.capabilities.includes(PLUGIN_CAPABILITY_MIXER)) return false;
    return MIXER_METHODS.every(method => typeof (instance as Record<string, unknown>)[method] === 'function');
};

/**
 * The mixer-capable view of a record, or `undefined` when it is not one.
 *
 * No priority, for {@link asAnalysisPlugin}'s reason: two mixers handed the same
 * parts produce two pieces of audio and there is nothing to merge, so choosing
 * between several installed plugins is a setting — see `render.mixerPluginId`.
 *
 * Deliberately a SEPARATE view from {@link asAnalysisPlugin} even though the
 * bundled plugin satisfies both. One plugin answering two capabilities is
 * ordinary here (`plugins/spotify` answers `catalog` and `stream`); what must not
 * be ordinary is one KEY answering two questions, which is what this exists to
 * end.
 */
export const asMixerPlugin = (record: PluginRecord): MixerPlugin | undefined => {
    if (record.status !== 'active' || !record.manifest || !record.instance) return undefined;
    if (!implementsMixer(record.manifest, record.instance)) return undefined;

    return { record, manifest: record.manifest, instance: record.instance as MixerProvider };
};
