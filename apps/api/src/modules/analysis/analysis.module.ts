import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { AnalysisRepository } from './analysis.repository.js';
import { AnalysisService } from './analysis.service.js';
import { AnalysisSlots } from './analysis.slots.js';

export const AnalysisModule: ServerKitModule = {
    name: 'Analysis',
    setup: async (registry: Registry, _: AppConfig) => {
        // Scoped, like the enrichment services it walks alongside: the job runner
        // gives every execution its own scope, so these are per-run there and
        // per-request on the request path.
        registry.register(AnalysisService).useClass(AnalysisService).asScoped();
        registry.register(AnalysisRepository).useClass(AnalysisRepository).asScoped();
        // A singleton, unlike the two above: it is the one count of measurements in flight across
        // every run, which a per-scope instance could not be. See `AnalysisSlots`.
        registry.register(AnalysisSlots).useClass(AnalysisSlots).asSingleton();
    },
};
