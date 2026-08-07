import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { EnrichmentReadService } from './enrichment.read.service.js';
import { EnrichmentRepository } from './enrichment.repository.js';
import { EnrichmentService } from './enrichment.service.js';

export const EnrichmentModule: ServerKitModule = {
    name: 'Enrichment',
    setup: async (registry: Registry, _: AppConfig) => {
        // Scoped, like the catalog services it writes alongside: the job runner
        // gives every execution its own scope, so these are per-run there and
        // per-request on the request path.
        registry.register(EnrichmentService).useClass(EnrichmentService).asScoped();
        registry.register(EnrichmentRepository).useClass(EnrichmentRepository).asScoped();

        // The read side of the same tables, reached from the catalog routes. Scoped
        // for the same reason, and separate so that reading a track's enrichment can
        // never turn into a fan-out at request time.
        registry.register(EnrichmentReadService).useClass(EnrichmentReadService).asScoped();
    },
};
