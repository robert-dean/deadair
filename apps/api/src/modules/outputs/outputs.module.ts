import { Container, Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { OutputsRepository } from './outputs.repository.js';
import { OutputsService } from './outputs.service.js';
import { OutputSpeakers } from './outputs.speakers.js';
import { OutputsSupervisor } from './outputs.supervisor.js';

/**
 * The station on speakers: every `output` plugin's speakers, the casts the operator started, and the
 * loop that keeps them playing.
 *
 * After `PluginsModule`, whose plugins it calls, and `NowPlayingModule`, which says what a speaker
 * shows. Late in the list so it tears down EARLY: the supervisor stops before the plugins it calls
 * are disposed, and before the playout it is putting speakers back on.
 *
 * A speaker the station leaves playing at shutdown is left playing on purpose. It is a listener,
 * and it will come back to a station that comes back; stopping every speaker on every restart would
 * make a deploy a room-by-room silence.
 */
export const OutputsModule: ServerKitModule = {
    name: 'Outputs',
    setup: async (registry: Registry, _: AppConfig) => {
        // Singletons, because the supervisor runs off the request path. The repository is scoped like
        // every other, and reached through `inScope` from there.
        registry.register(OutputSpeakers).useClass(OutputSpeakers).asSingleton();
        registry.register(OutputsSupervisor).useClass(OutputsSupervisor).asSingleton();
        registry.register(OutputsRepository).useClass(OutputsRepository).asScoped();
        // Scoped: it answers the console's routes and reads the request's actor.
        registry.register(OutputsService).useClass(OutputsService).asScoped();
    },

    ready: async (container: Container, signal: AbortSignal) => {
        if (signal.aborted) return;
        container.get(OutputsSupervisor).start();
    },

    shutdown: async (container: Container) => {
        await container.get(OutputsSupervisor).stop();
    },
};
