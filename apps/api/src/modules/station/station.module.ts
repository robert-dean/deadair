import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { StationAttentionService } from './station.attention.service.js';
import { StationCheckupService } from './station.checkup.service.js';
import { TracesService } from './traces.service.js';
import { LogsService } from './logs.service.js';

/**
 * The station about itself, composed across everything else.
 *
 * Two routes: what needs somebody, and the machinery underneath it. It owns no table, writes nothing and starts nothing — the
 * whole of it is that facts an operator needs together are scattered across the five pages that own
 * them, and an operator has to already be on a page to find out that page has something wrong on it.
 *
 * ## Last, because it reads everything
 *
 * Registered after `ProductionsModule` and before `DataConnectionsModule`. It resolves playout, the
 * director's console service, the catalog and the plugin host, so it has to sit below all of them —
 * and since shutdown walks this list forwards too, sitting at the end means nothing else is torn
 * down against it. Nothing resolves this module, which is what makes that position free.
 *
 * ## It is not a health check
 *
 * The same line `silence.diagnosis.ts` draws, and for the same reason: several of the states this
 * composes describe a perfectly healthy process doing what it was told. Only faults reach the list,
 * and the wording of the ones it did not work out for itself belongs to whoever did.
 */
export const StationModule: ServerKitModule = {
    name: 'Station',
    setup: async (registry: Registry) => {
        // Scoped, like every other request-path service: it opens no loop and holds nothing between
        // requests, and the repositories under it are scoped already.
        registry.register(StationAttentionService).useClass(StationAttentionService).asScoped();
        // Scoped for the same reason, even though the heartbeat map it reads is a singleton: what
        // makes a service scoped here is the repositories under it, not the facts it reports.
        registry.register(StationCheckupService).useClass(StationCheckupService).asScoped();
        // Scoped like the other two, though it reads neither a repository nor a singleton: it scans
        // files. What decides the lifetime here is that it is a request-path service and nothing
        // else, which is the same answer the two above give for different reasons.
        registry.register(TracesService).useClass(TracesService).asScoped();
        // Scoped on the same answer `TracesService` gives above: it reads files rather than a
        // repository or a singleton, so nothing forces a lifetime on it, and being a request-path
        // service is the whole of the reason. The `RotatingLogStore` it also reads is NOT injected —
        // it comes from the process-wide holder, which is what keeps this module free of a
        // registration `PluginsModule` owns.
        registry.register(LogsService).useClass(LogsService).asScoped();
    },
};
