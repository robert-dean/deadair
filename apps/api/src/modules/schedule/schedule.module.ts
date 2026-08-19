import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { ScheduleRepository } from './schedule.repository.js';
import { ScheduleService } from './schedule.service.js';

/**
 * The station's day, as something an operator writes.
 *
 * Registered after PlaylistsModule and PersonasModule, whose rows a slot names, and before
 * DirectorModule, which is what actually changes the station over. Nothing here reaches forward into
 * any of them: a slot stores ids and the two things that read them resolve them at the moment they
 * are used, which is also what lets a deleted persona or a vanished playlist be a fallback rather
 * than a fault.
 *
 * **It owns no loop and starts nothing**, which is the point. `docs/decisions/on-air-ownership.md`
 * settles that the schedule is a stored document, a pure resolver and a timer that posts commands,
 * and that a second stateful owner of what airs would rebuild the defect that document exists to
 * remove. The resolver lives in `#modules/director/schedule.js` beside the running order it answers
 * for, the timer is a job, and this module is only the table underneath both.
 *
 * It seeds nothing either. An empty schedule is a coherent schedule: it means the station keeps
 * doing what an operator put it on, which is exactly what every station did before this existed.
 */
export const ScheduleModule: ServerKitModule = {
    name: 'Schedule',

    setup: async (registry: Registry) => {
        // Scoped, like every other repository and console service: per-request on the request path,
        // per-run inside the scope the tick opens.
        registry.register(ScheduleRepository).useClass(ScheduleRepository).asScoped();
        registry.register(ScheduleService).useClass(ScheduleService).asScoped();
    },
};
