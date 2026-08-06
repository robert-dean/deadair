import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { EnrichmentService } from './enrichment.service.js';

export const EnrichmentModule: ServerKitModule = {
    name: 'Enrichment',
    setup: async (registry: Registry, _: AppConfig) => {
        // Scoped, like the catalog services it will write through: the job
        // runner gives every execution its own scope, so this is per-run there
        // and per-request on the request path.
        registry.register(EnrichmentService).useClass(EnrichmentService).asScoped();
    },
};
