import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import {
    ENRICHMENT_MATCH_KEY_ARTIST_TITLE,
    ENRICHMENT_MATCH_KEY_ISRC,
    PLUGIN_CAPABILITY_ENRICHMENT,
    PLUGIN_KIND_ENRICHMENT,
    type EnrichmentMatchKey,
    type EnrichmentPluginInstance,
    type TrackEnrichment,
    type TrackRef,
} from '@deadair/plugin-sdk';
import { PluginInvoker } from './plugin.invoker.js';
import { PluginRegistry } from './plugin.registry.js';

/**
 * What the chain returns. Every field stays optional: the merge of partials is
 * itself partial, and nothing guarantees any single field was resolved.
 */
export type MergedTrackEnrichment = Partial<TrackEnrichment>;

/** Priority assumed for a plugin that declares none. Matches the SDK's "supplementary" tier. */
const DEFAULT_PRIORITY = 500;

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Case and whitespace are not identity; two spellings of the same track share a lookup. */
const normalize = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The single-flight key for a track. ISRC identifies a recording exactly, so it
 * wins whenever it is present; the artist/title pair is the fallback.
 */
const matchKeyFor = (ref: TrackRef): string => {
    const isrc = ref.isrc?.trim();
    if (isrc) return `isrc:${isrc.toUpperCase()}`;
    return `at:${normalize(ref.artist)}|${normalize(ref.title)}`;
};

/** Which match keys a ref can actually be looked up by. */
const availableMatchKeys = (ref: TrackRef): EnrichmentMatchKey[] => {
    const keys: EnrichmentMatchKey[] = [];
    if (ref.isrc?.trim()) keys.push(ENRICHMENT_MATCH_KEY_ISRC);
    if (ref.artist.trim() && ref.title.trim()) keys.push(ENRICHMENT_MATCH_KEY_ARTIST_TITLE);
    return keys;
};

/**
 * Runs every active enrichment plugin over a track and merges what they know
 * into one object.
 *
 * Two rules make the result deterministic. Priority orders the merge (lower
 * first, and the first plugin to fill a field keeps it), so adding a plugin can
 * never silently change what an existing higher-priority one contributed. And
 * lookups are single-flighted per match key, because the same track is enriched
 * from several places at once (the rundown builder, the now-playing card, the
 * DJ script) and there is no reason to pay for the same fan-out three times.
 *
 * Never rejects: a plugin that fails contributes nothing.
 */
@Injectable()
export class EnrichmentChain {
    /** Match key -> the fan-out currently running for it. */
    private readonly inFlight = new Map<string, Promise<MergedTrackEnrichment>>();

    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly logger: Logger,
    ) {}

    /**
     * Everything the enabled enrichment plugins know about `ref`. Resolves to
     * `{}` when nothing is installed, nothing matches, or everything fails.
     */
    async enrich(ref: TrackRef): Promise<MergedTrackEnrichment> {
        const key = matchKeyFor(ref);

        const existing = this.inFlight.get(key);
        if (existing) return existing;

        const running = this.run(ref).finally(() => {
            this.inFlight.delete(key);
        });
        this.inFlight.set(key, running);
        return running;
    }

    private async run(ref: TrackRef): Promise<MergedTrackEnrichment> {
        const providers = this.providersFor(ref);
        if (providers.length === 0) return {};

        const results = await Promise.all(
            providers.map(async ({ pluginId, instance }) => {
                try {
                    return await this.pluginInvoker.invoke(pluginId, 'enrichment.enrichTrack', async () => instance.enrichTrack(ref));
                } catch (error) {
                    // The invoker has already recorded this against the plugin;
                    // the chain's job is simply to carry on without it.
                    this.logger.debug('enrichment plugin contributed nothing', { plugin: pluginId, error: errorText(error) });
                    return undefined;
                }
            }),
        );

        const merged: Record<string, unknown> = {};
        for (const result of results) {
            if (!result) continue;
            for (const [field, value] of Object.entries(result)) {
                if (value === undefined || value === null) continue;
                // First writer wins, and `results` is in priority order.
                if (Object.hasOwn(merged, field)) continue;
                merged[field] = value;
            }
        }

        return merged as MergedTrackEnrichment;
    }

    /**
     * Active enrichment plugins that can match this ref, lowest priority number
     * first. A plugin that only matches on ISRC is skipped for a ref without
     * one rather than being asked a question it cannot answer.
     */
    private providersFor(ref: TrackRef): { pluginId: string; priority: number; instance: EnrichmentPluginInstance }[] {
        const keys = availableMatchKeys(ref);
        if (keys.length === 0) return [];

        return this.pluginRegistry
            .byCapability(PLUGIN_KIND_ENRICHMENT, PLUGIN_CAPABILITY_ENRICHMENT)
            .flatMap(record => {
                const instance = record.instance as EnrichmentPluginInstance | undefined;
                if (!instance || typeof instance.enrichTrack !== 'function') return [];

                const declared = Array.isArray(instance.matchKeys) ? instance.matchKeys : [];
                if (declared.length > 0 && !declared.some(key => keys.includes(key))) return [];

                const priority = typeof instance.priority === 'number' ? instance.priority : DEFAULT_PRIORITY;
                return [{ pluginId: record.id, priority, instance }];
            })
            .sort((left, right) => left.priority - right.priority || left.pluginId.localeCompare(right.pluginId));
    }
}
