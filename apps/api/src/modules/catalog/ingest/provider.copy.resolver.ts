import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { ProviderTrack } from '@deadair/plugin-sdk';
import { asCatalogPlugin } from '#modules/plugins/plugin.capabilities.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { errorText } from '#modules/shared/error.text.js';
import { CatalogResolverRepository } from './catalog.resolver.repository.js';
import { CatalogResolverService } from './catalog.resolver.service.js';

/** One provider's copy of a record, as that provider describes it now. */
export interface ProviderCopy {
    pluginId: string;
    track: ProviderTrack;
}

/**
 * Turns one provider's id for a record into a library record: the binding the library already has,
 * else the copy that plugin hands back for the id, ingested as `discovered`.
 *
 * `discovered` because nothing else will ever walk past this copy again, and that origin is what keeps
 * the sync's missing sweep from benching it. The callers decide whether the station may take records
 * in at all (`rotation.discover`); this only does the taking.
 *
 * `operation` names the caller in the invoker's log and its failure count, so a plugin quarantined by
 * a run of failures says which path ran it into the ground.
 */
@Injectable()
export class ProviderCopyResolver {
    constructor(
        private readonly library: CatalogResolverRepository,
        private readonly ingest: CatalogResolverService,
        private readonly registry: PluginRegistry,
        private readonly invoker: PluginInvoker,
        private readonly logger: Logger,
    ) {}

    /** The library record this provider id names, taking the copy in first when it is new here. */
    async resolve(pluginId: string, externalId: string, operation: string): Promise<string | undefined> {
        const bound = await this.library.findTrackSource(pluginId, externalId);
        if (bound !== undefined) return bound;
        const copy = await this.copy(pluginId, externalId, operation);
        return copy === undefined ? undefined : await this.take(copy.pluginId, copy.track);
    }

    /**
     * The copy as that plugin describes it now, or nothing when the plugin is not here, cannot be asked
     * for one track, or no longer has it.
     */
    async copy(pluginId: string, externalId: string, operation: string): Promise<ProviderCopy | undefined> {
        const record = this.registry.get(pluginId);
        const catalog = record === undefined ? undefined : asCatalogPlugin(record);
        if (catalog === undefined || typeof catalog.instance.getTrack !== 'function') return undefined;

        try {
            const track = await this.invoker.invoke(pluginId, operation, async () => await catalog.instance.getTrack!(externalId));
            return track === undefined ? undefined : { pluginId, track };
        } catch (error) {
            this.logger.info(`catalog: ${pluginId} could not be asked for one of its records (${operation}: ${errorText(error)})`);
            return undefined;
        }
    }

    /** Ingest a found copy as `discovered`, which is what keeps the sync's sweep off it. */
    async take(pluginId: string, track: ProviderTrack): Promise<string | undefined> {
        const result = await this.ingest.ingestTrack(pluginId, track, 'discovered');
        return result.status === 'skipped' ? undefined : result.trackId;
    }
}
