import { Container, Registry } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { PersonaRepository } from './persona.repository.js';
import { PersonaDistilService } from './persona.distil.service.js';
import { PersonaExportService } from './persona.export.service.js';
import { PersonaImportService } from './persona.import.service.js';
import { PersonaNotesRepository } from './persona.notes.repository.js';
import { PersonaNotesService } from './persona.notes.service.js';
import { PersonaRehearsalService } from './persona.rehearsal.service.js';
import { PersonaStoriesRepository } from './persona.stories.repository.js';
import { PersonaStoriesService } from './persona.stories.service.js';
import { PersonaStoryPassService } from './persona.story.pass.service.js';
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
        registry.register(PersonaNotesRepository).useClass(PersonaNotesRepository).asScoped();
        registry.register(PersonaStoriesRepository).useClass(PersonaStoriesRepository).asScoped();
        registry.register(PersonasService).useClass(PersonasService).asScoped();
        registry.register(PersonaNotesService).useClass(PersonaNotesService).asScoped();
        registry.register(PersonaStoriesService).useClass(PersonaStoriesService).asScoped();
        // Scoped like the rest, and resolved only by a request. It reads the two repositories above
        // and nothing else: handing a character over is a read, and the half that takes one back is
        // its own service beside this one rather than a second mode of it.
        registry.register(PersonaExportService).useClass(PersonaExportService).asScoped();
        // Beside it, and the mirror image: it reads the same two repositories plus the render
        // module's voices and soundboards, which are the two vocabularies a sheet can point at.
        // Reaching FORWARD in `modules.ts`, which that list permits at request time and only there.
        registry.register(PersonaImportService).useClass(PersonaImportService).asScoped();
        // Scoped like the rest, and resolved by a cron job rather than by a request. It reaches
        // FORWARDS into `RenderModule` for the script history, which is the same thing
        // `PersonaRehearsalService` does into the director and is fine for the same reason: this
        // list is a lifecycle order, not a resolution order.
        registry.register(PersonaDistilService).useClass(PersonaDistilService).asScoped();
        // The same arrangement one table over, and resolved by its own cron job. It reaches no
        // further than this module and the LLM one, which is why it is registered beside the pass it
        // is modelled on rather than anywhere more careful.
        registry.register(PersonaStoryPassService).useClass(PersonaStoryPassService).asScoped();
        // Scoped like the two above, and it resolves `BreakWriterRegistry` out of the director's
        // registrations at REQUEST time — which is why this module being registered before that one
        // costs nothing. The list is a lifecycle order (start, ready, shutdown), not a resolution
        // order, and nothing here reaches into the director at boot.
        registry.register(PersonaRehearsalService).useClass(PersonaRehearsalService).asScoped();
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
