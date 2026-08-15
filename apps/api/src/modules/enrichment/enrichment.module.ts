import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { EnrichmentReadService } from './enrichment.read.service.js';
import { EnrichmentRepository } from './enrichment.repository.js';
import { EnrichmentService } from './enrichment.service.js';
import { LineupPriorityReader } from './lineup.priority.js';
import { FactExtractionService } from './fact.extraction.service.js';
import { FactRepository } from './fact.repository.js';

export const EnrichmentModule: ServerKitModule = {
    name: 'Enrichment',
    setup: async (registry: Registry, _: AppConfig) => {
        // Scoped, like the catalog services it writes alongside: the job runner
        // gives every execution its own scope, so these are per-run there and
        // per-request on the request path.
        registry.register(EnrichmentService).useClass(EnrichmentService).asScoped();
        registry.register(EnrichmentRepository).useClass(EnrichmentRepository).asScoped();

        // What the station is about to play, which is what decides the ORDER of the
        // walk above. Scoped for the reason everything here is, and registered in
        // this module rather than the director's because it is a reader of that
        // module's repository and nothing in `director/` asks for it.
        registry.register(LineupPriorityReader).useClass(LineupPriorityReader).asScoped();

        // The read side of the same tables, reached from the catalog routes. Scoped
        // for the same reason, and separate so that reading a track's enrichment can
        // never turn into a fan-out at request time.
        registry.register(EnrichmentReadService).useClass(EnrichmentReadService).asScoped();

        // The claims the host extracted out of what those plugins handed over,
        // which is a different kind of thing from a provider's payload and so a
        // separate store. Scoped for the same reason as everything above: the
        // job runner gives every run its own scope, and the read side of this is
        // reached from the break writer's own.
        registry.register(FactRepository).useClass(FactRepository).asScoped();
        registry.register(FactExtractionService).useClass(FactExtractionService).asScoped();
    },
};
