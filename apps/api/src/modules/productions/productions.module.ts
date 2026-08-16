import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { ProductionRepository } from './production.repository.js';

/**
 * What the station MAKES, as against what it says.
 *
 * Registered after RenderModule and DirectorModule, and the ordering is a real edge rather than a
 * tidy one. A production's beats ARE `deadair.segments` rows, so everything that produces one goes
 * through the render path's claims, its `RenderSegmentJob` and its content store; and a finished
 * production reaches air only through the director, which is the sole writer of the running order.
 * Nothing in either of those reaches forward into this.
 *
 * It owns no loop and starts nothing. A production is made entirely by jobs, each running one pass,
 * because that is what makes a restart resumable and what leaves the station's one model slot free
 * between passes — see `production.passes.ts`.
 */
export const ProductionsModule: ServerKitModule = {
    name: 'Productions',

    setup: async (registry: Registry) => {
        // Scoped, like every other repository: per-request on the request path, per-run inside the
        // scope a pass job opens.
        registry.register(ProductionRepository).useClass(ProductionRepository).asScoped();
    },
};
