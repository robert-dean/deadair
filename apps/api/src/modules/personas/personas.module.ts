import { Container, Registry } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { PersonaRepository } from './persona.repository.js';
import { PersonasService } from './personas.service.js';
import { inScope } from '#modules/shared/scoped.work.js';

/**
 * Who the station is when it opens its mouth.
 *
 * Registered before RenderModule and DirectorModule, which are the two that read a persona — one for
 * the voice that speaks a break, one for the words and the phrasings underneath them — and after
 * SettingsModule, because a persona's on-air name overrides `station.djName` rather than replacing
 * it. Nothing here reaches forward into either.
 *
 * It owns no loop and starts nothing. The one thing it does at boot is seed a station that has no
 * personas at all, and that is in `ready()` rather than `setup()` because no first request depends
 * on it: a station that answered a request a second before its seeds landed is a station with no
 * persona, which every reader downstream already treats as an ordinary state.
 */
export const PersonasModule: ServerKitModule = {
    name: 'Personas',

    setup: async (registry: Registry) => {
        // Scoped, like every other repository: per-request on the request path, per-run inside the
        // scope the boot seed opens.
        registry.register(PersonaRepository).useClass(PersonaRepository).asScoped();
        registry.register(PersonasService).useClass(PersonasService).asScoped();
    },

    ready: async (container: Container, signal: AbortSignal) => {
        if (signal.aborted) return;

        // Never fatal. A station that could not be seeded is a station with no persona, which is
        // exactly what it was before this module existed, and it airs perfectly well.
        try {
            await inScope(container, async scope => {
                await scope.get(PersonasService).seed();
            });
        } catch (error) {
            container.get(Logger).warn('personas: could not seed the station, so it starts with no persona', { error });
        }
    },
};
