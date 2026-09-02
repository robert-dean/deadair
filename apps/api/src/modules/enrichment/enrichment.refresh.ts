import { Container, Injectable } from 'injectkit';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { Logger } from '@maroonedsoftware/logger';
import { StationBus } from '#modules/shared/station.bus.js';
import { errorText } from '#modules/shared/error.text.js';
import { inScope } from '#modules/shared/scoped.work.js';
import { EnrichmentRepository } from './enrichment.repository.js';
import { EnrichmentService } from './enrichment.service.js';

/**
 * A provider's settings changed, so what it already stored is now stale.
 *
 * `PluginsService.updatePluginConfig` publishes `plugin.configured` and knows nothing about
 * enrichment; this is the subscriber on the other side, following `WelcomeAnnouncer`'s shape for the
 * same reason — what the station does about a plugin's settings changing is this module's decision,
 * not `plugins`', so it lives here as its own class rather than a branch in `PluginsService`.
 *
 * A settings change is not always a reason to refresh: the id on the event is whatever plugin was
 * saved, most of which have nothing to do with enrichment at all. `EnrichmentService.providerIds()`
 * is the same list the walk itself asks about, so a plugin that is not on it is left alone rather
 * than expiring rows that do not exist.
 *
 * `EnrichmentService` and `EnrichmentRepository` are both scoped, and this is a singleton for the
 * reason `WelcomeAnnouncer` and `ActivityRecorder` already are — it holds the bus subscription, and
 * an event may arrive with no request in flight to borrow a connection from. So each event opens its
 * own scope, per `#modules/shared/scoped.work.js`, rather than capturing either at construction.
 */
@Injectable()
export class EnrichmentRefresh {
    private unsubscribe?: () => void;

    constructor(
        // The ROOT container, resolved from for the reason `scoped.work.ts` states: this class's own
        // dependencies come from the root, and opening a scope off anything else would make it the
        // child of a scope that may already be gone.
        private readonly container: Container,
        private readonly bus: StationBus,
        private readonly jobs: PgBossJobBroker,
        private readonly logger: Logger,
    ) {}

    /** Begin listening. Idempotent. */
    start(): void {
        if (this.unsubscribe !== undefined) return;

        this.unsubscribe = this.bus.subscribe('plugin.configured', event => this.refresh(event.pluginId));
    }

    /** Stop listening. */
    stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }

    /**
     * Nothing is awaited by the caller: this runs in the publisher's own stack frame (`StationBus`
     * fans out synchronously), which has nobody to hand a rejection to. The `catch` is the same shape
     * every producerless subscriber here uses.
     */
    private refresh(pluginId: string): void {
        void inScope(this.container, async scope => {
            const enrichment = scope.get(EnrichmentService);
            if (!enrichment.providerIds().includes(pluginId)) return;

            const expired = await scope.get(EnrichmentRepository).expireProvider(pluginId);
            this.logger.info(`enrichment: expired ${expired} row(s) after ${pluginId}'s settings changed`, { pluginId });

            await this.jobs.send('catalog.enrich', {});
        }).catch(error => {
            this.logger.warn(`enrichment: could not refresh after ${pluginId}'s settings changed (${errorText(error)})`, { pluginId });
        });
    }
}
