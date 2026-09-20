import {
    PLUGIN_CAPABILITY_ANALYSIS,
    PLUGIN_CAPABILITY_CHARTS,
    PLUGIN_CAPABILITY_ENRICHMENT,
    PLUGIN_CAPABILITY_LLM,
    PLUGIN_CAPABILITY_MIXER,
    PLUGIN_CAPABILITY_SIMILARITY,
    PLUGIN_CAPABILITY_SPEECH,
    PLUGIN_CAPABILITY_WEATHER,
} from '@deadair/plugin-sdk';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { ANALYSIS_PLUGIN_KEY } from '#modules/analysis/analysis.settings.js';
import { CHARTS_KEYS } from '#modules/charts/charts.keys.js';
import { ENRICHMENT_KEYS } from '#modules/enrichment/enrichment.keys.js';
import { LLM_PLUGIN_KEY } from '#modules/llm/llm.settings.js';
import { MIXER_PLUGIN_KEY } from '#modules/render/mixer.settings.js';
import { SPEECH_PLUGIN_KEY } from '#modules/render/speech.settings.js';
import { SIMILARITY_ORDER_KEY } from '#modules/similarity/similarity.settings.js';
import { WEATHER_KEYS } from '#modules/weather/weather.keys.js';
import {
    asAnalysisPlugin,
    asLlmPlugin,
    asMixerPlugin,
    asChartsPlugin,
    asEnrichmentPlugin,
    asSimilarityPlugin,
    asSpeechPlugin,
    asWeatherPlugin,
    type AnalysisPlugin,
    type ChartsPlugin,
    type EnrichmentPlugin,
    type LlmPlugin,
    type MixerPlugin,
    type SimilarityPlugin,
    type SpeechPlugin,
    type WeatherPlugin,
} from './plugin.capabilities.js';
import { byOrderThen, pluginOrder } from './plugin.order.js';
import { pluginsWith, selectPlugin } from './plugin.selection.js';
import type { PluginRecord } from './types/plugin.record.js';

/**
 * Every capability whose answer depends on WHICH plugin, and the setting that
 * decides it.
 *
 * ## Why this is a table rather than a paragraph in each service
 *
 * The rules were already shared — `selectPlugin` for the one-answer
 * capabilities, `byOrderThen` for the fanned-out ones — but the PAIRING of a
 * capability with its setting key, its view and its fallback was written out at
 * each call site. That is fine until something other than the service needs the
 * same pairing, and something does: the console cannot show an operator who is
 * in use, who is asked second and who is named but not running without knowing
 * exactly what the station knows. Given the pairing in prose, the console's
 * answer is a second implementation of `selectPlugin`'s two rules, which is how
 * a settings page ends up confidently naming a different plugin than the one
 * the station reaches. `declared.options.ts` had begun doing precisely that.
 *
 * So the table is the seam, and both sides read it: the services sort and
 * select through {@link pluginsInOrder} and {@link pluginInUse}, and
 * `PluginProvidersService` reports from the same entries.
 *
 * ## What is NOT here
 *
 * Capabilities that fan out and merge without ranking — search, scrobble,
 * podcast, narration, catalog, and the news PLUGINS as opposed to the news
 * feeds. Order changes nothing about a union, so an ordering setting there
 * would be a knob whose every position is the same. Each of those carries its
 * own paragraph in `plugin.capabilities.ts` saying why.
 */

/** Whether a capability has one answer or is asked of everything in turn. */
export type ProviderMode = 'one' | 'ordered';

/** The shape every capability view produces, and the least this file needs of one. */
interface ProvidedPlugin {
    record: PluginRecord;
}

/**
 * One capability's pairing: how it chooses, what setting says so, how a record
 * becomes a candidate, and what orders the ones the operator did not name.
 */
export interface ProviderCapability<TPlugin extends ProvidedPlugin = ProvidedPlugin> {
    /** The manifest capability string, which is also the console's anchor for it. */
    capability: string;
    mode: ProviderMode;
    /** The `deadair.settings` key: a plugin id for `one`, a list of them for `ordered`. */
    settingKey: string;
    /** The capability view. Anything it declines cannot do the job right now. */
    as: (record: PluginRecord) => TPlugin | undefined;
    /**
     * What orders the plugins the operator did not list, for `ordered`
     * capabilities. Absent means `byPluginId`, which is alphabetical and is what
     * every capability but enrichment sorted by before any of this existed.
     *
     * Declared as a METHOD rather than as a property holding a function, which
     * is what makes the table enumerable as one list. A property would be
     * checked contravariantly under `strictFunctionTypes`, so enrichment's
     * comparator over `EnrichmentPlugin` would not be assignable to the erased
     * `ProviderCapability` the list is typed as, and `providerCapabilities()`
     * would not compile. The bivariance a method signature allows is sound
     * here for a reason narrower than TypeScript can express: a fallback is
     * only ever called with plugins its OWN entry's `as` produced, which
     * {@link pluginsInOrder} is the single place that arranges.
     */
    fallback?(left: TPlugin, right: TPlugin): number;
}

/**
 * The capabilities an operator chooses between, keyed by capability name.
 *
 * Ordered as the console should draw them: what the station SAYS, then what it
 * plays, then what it knows.
 */
export const PROVIDER_CAPABILITIES = {
    [PLUGIN_CAPABILITY_SPEECH]: {
        capability: PLUGIN_CAPABILITY_SPEECH,
        mode: 'one',
        settingKey: SPEECH_PLUGIN_KEY,
        as: asSpeechPlugin,
    } satisfies ProviderCapability<SpeechPlugin>,
    [PLUGIN_CAPABILITY_LLM]: {
        capability: PLUGIN_CAPABILITY_LLM,
        mode: 'one',
        settingKey: LLM_PLUGIN_KEY,
        as: asLlmPlugin,
    } satisfies ProviderCapability<LlmPlugin>,
    [PLUGIN_CAPABILITY_MIXER]: {
        capability: PLUGIN_CAPABILITY_MIXER,
        mode: 'one',
        settingKey: MIXER_PLUGIN_KEY,
        as: asMixerPlugin,
    } satisfies ProviderCapability<MixerPlugin>,
    [PLUGIN_CAPABILITY_ANALYSIS]: {
        capability: PLUGIN_CAPABILITY_ANALYSIS,
        mode: 'one',
        settingKey: ANALYSIS_PLUGIN_KEY,
        as: asAnalysisPlugin,
    } satisfies ProviderCapability<AnalysisPlugin>,
    [PLUGIN_CAPABILITY_SIMILARITY]: {
        capability: PLUGIN_CAPABILITY_SIMILARITY,
        mode: 'ordered',
        settingKey: SIMILARITY_ORDER_KEY,
        as: asSimilarityPlugin,
    } satisfies ProviderCapability<SimilarityPlugin>,
    [PLUGIN_CAPABILITY_WEATHER]: {
        capability: PLUGIN_CAPABILITY_WEATHER,
        mode: 'ordered',
        settingKey: WEATHER_KEYS.providerOrder,
        as: asWeatherPlugin,
    } satisfies ProviderCapability<WeatherPlugin>,
    [PLUGIN_CAPABILITY_CHARTS]: {
        capability: PLUGIN_CAPABILITY_CHARTS,
        mode: 'ordered',
        settingKey: CHARTS_KEYS.providerOrder,
        as: asChartsPlugin,
    } satisfies ProviderCapability<ChartsPlugin>,
    [PLUGIN_CAPABILITY_ENRICHMENT]: {
        capability: PLUGIN_CAPABILITY_ENRICHMENT,
        mode: 'ordered',
        settingKey: ENRICHMENT_KEYS.providerOrder,
        as: asEnrichmentPlugin,
        // The one capability whose fallback is not alphabetical, because it had a precedence of
        // its own before any of this: the plugin author's declared `priority`, read once in
        // `asEnrichmentPlugin` so one plugin cannot sort differently for two callers. An empty
        // setting therefore reproduces that order exactly, and what the operator names overrides
        // it for those plugins only.
        fallback: (left, right) => left.priority - right.priority,
    } satisfies ProviderCapability<EnrichmentPlugin>,
} as const;

/** Every entry, in the order the console draws them. */
export const providerCapabilities = (): readonly ProviderCapability[] => Object.values(PROVIDER_CAPABILITIES);

/**
 * The plugins that can do a job right now, in the order the station asks them.
 *
 * The whole of what an `ordered` capability's service does, so the sort is not
 * written out once per capability with one of them quietly disagreeing. Read
 * per call rather than cached: the services holding this are SCOPED, so it is
 * once per pass, and an operator's change applies to the next one without a
 * reload hook.
 *
 * @param records - Installed plugin records, usually `registry.list()`.
 * @param config - Live station config, for the order setting.
 * @param capability - The table entry. A `one` entry works here too: its
 *   setting holds a single plugin id rather than rows, which `pluginOrder`
 *   reads as no order at all, leaving the candidates in the `byPluginId` order
 *   {@link selectPlugin} documents as "first".
 */
export function pluginsInOrder<TPlugin extends ProvidedPlugin>(
    records: Iterable<PluginRecord | undefined>,
    config: AppConfig,
    capability: ProviderCapability<TPlugin>,
): TPlugin[] {
    return pluginsWith(records, capability.as).sort(byOrderThen(pluginOrder(config, capability.settingKey), capability.fallback));
}

/**
 * The one plugin a `one` capability uses, or `undefined` when the station has
 * none.
 *
 * `selectPlugin`'s two rules over the table's own candidates, so a caller that
 * only wants the answer does not restate the pairing. The services that must
 * also REPORT what they passed over keep calling `selectPlugin` themselves,
 * since that needs the candidate list in hand.
 */
export function pluginInUse<TPlugin extends ProvidedPlugin>(
    records: Iterable<PluginRecord | undefined>,
    config: AppConfig,
    capability: ProviderCapability<TPlugin>,
): TPlugin | undefined {
    return selectPlugin(pluginsInOrder(records, config, capability), config.get(capability.settingKey, ''));
}
