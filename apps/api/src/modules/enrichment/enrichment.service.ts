import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ENRICHMENT_MATCH_KEY_ARTIST_TITLE, ENRICHMENT_MATCH_KEY_ISRC, type TrackEnrichment, type TrackRef } from '@deadair/plugin-sdk';
import { asEnrichmentPlugin, type EnrichmentPlugin } from '#modules/plugins/plugin.capabilities.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { mergeEnrichment, sanitizeEnrichment } from './enrichment.merge.js';

/** What one plugin contributed, kept apart from the merge because it is stored per provider. */
export interface EnrichmentContribution {
    pluginId: string;
    priority: number;
    enrichment: Partial<TrackEnrichment>;
}

/** A plugin that was asked and could not answer. Reported, never thrown. */
export interface EnrichmentFailure {
    pluginId: string;
    message: string;
}

export interface EnrichmentResult {
    /** Every plugin's answer folded together in priority order. */
    enrichment: Partial<TrackEnrichment>;
    /** The answers themselves, in the order they were merged. Empty answers are dropped. */
    contributions: EnrichmentContribution[];
    failures: EnrichmentFailure[];
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Whether it is worth asking this plugin about this track.
 *
 * `matchKeys` is the plugin telling the host what it can look a track up by,
 * and the honest reading of a plugin that only declares `isrc` is that a track
 * without one is not a question it can answer. Asking anyway would spend a
 * rate-limited request to be told nothing.
 */
export const canMatch = (plugin: EnrichmentPlugin, ref: TrackRef): boolean => {
    const keys = plugin.instance.matchKeys ?? [];
    if (keys.includes(ENRICHMENT_MATCH_KEY_ARTIST_TITLE)) return true;
    return keys.includes(ENRICHMENT_MATCH_KEY_ISRC) && ref.isrc !== undefined;
};

/**
 * The fan-out half of enrichment: ask every enrichment plugin about one track
 * and fold their answers into one.
 *
 * This is the piece the SDK has always described and nothing implemented.
 * Deliberately free of the database and of HTTP: it takes a `TrackRef` and
 * returns what was learned, so the job that walks the catalog, a future route
 * that enriches one track on demand, and a test all drive the identical path.
 *
 * A plugin that fails is data, not an exception. One quarantined source must
 * not deny the station everything the others knew, so a failure is recorded
 * against its plugin and the pass continues; `PluginInvoker` is already
 * counting those failures towards the breaker that will stop it being asked.
 */
@Injectable()
export class EnrichmentService {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly logger: Logger,
    ) {}

    /**
     * Every plugin that could answer right now, lowest `priority` first.
     *
     * Order is fixed here rather than at the call sites so the merge and the
     * "which providers has this track heard from" question cannot disagree
     * about who is running.
     */
    providers(): EnrichmentPlugin[] {
        const plugins: EnrichmentPlugin[] = [];
        for (const record of this.pluginRegistry.list()) {
            const plugin = asEnrichmentPlugin(record);
            if (plugin) plugins.push(plugin);
        }
        return plugins.sort((left, right) => left.priority - right.priority || left.record.id.localeCompare(right.record.id));
    }

    /** The ids of {@link providers}, which is what the catalog stores as `provider`. */
    providerIds(): string[] {
        return this.providers().map(plugin => plugin.record.id);
    }

    /**
     * Asks every capable plugin about one track.
     *
     * Sequential rather than concurrent, on purpose. Enrichment sources publish
     * rate limits measured in single requests per second and the host paces
     * each one to them, so parallelism here buys nothing except several plugins
     * simultaneously parked on their limiters, all spending the same deadline.
     */
    async enrich(ref: TrackRef, signal?: AbortSignal): Promise<EnrichmentResult> {
        const contributions: EnrichmentContribution[] = [];
        const failures: EnrichmentFailure[] = [];

        for (const plugin of this.providers()) {
            if (signal?.aborted) break;
            if (!canMatch(plugin, ref)) continue;

            const pluginId = plugin.record.id;
            try {
                const answer = await this.pluginInvoker.invoke(pluginId, 'enrichment.enrichTrack', async () => plugin.instance.enrichTrack(ref));
                const enrichment = sanitizeEnrichment(answer);
                // An empty answer is the ordinary "I do not have this track".
                // Recording it as a contribution would write an empty payload
                // over whatever that provider knew last month.
                if (Object.keys(enrichment).length === 0) continue;
                contributions.push({ pluginId, priority: plugin.priority, enrichment });
            } catch (error) {
                const message = errorText(error);
                failures.push({ pluginId, message });
                this.logger.warn('enrichment plugin failed', { pluginId, artist: ref.artist, title: ref.title, error: message });
            }
        }

        return { enrichment: mergeEnrichment(contributions.map(contribution => contribution.enrichment)), contributions, failures };
    }
}
