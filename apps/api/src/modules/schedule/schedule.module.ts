import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { PlaylistPositionRepository } from './playlist.position.repository.js';
import { PreparedSetRepository } from './prepared.set.repository.js';
import { LiveArmRepository } from './live.arm.repository.js';
import { LiveBookings, LiveNotices } from './live.bookings.js';
import { ScheduleRepository } from './schedule.repository.js';
import { ScheduleNotices } from './schedule.notices.js';
import { OpeningWait } from './opening.wait.js';
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
 * **It owns no loop and starts nothing**, which is the point. The ownership rule
 * (`docs/internals/director.md` § "Who owns the running order") settles that the schedule is a stored
 * document, a pure resolver and a timer that posts commands, and that a second stateful owner of what
 * airs would rebuild the defect that document exists to remove. The resolver lives in
 * `#modules/director/schedule.js` beside the running order it answers for, the timer is a job, and
 * this module is only the table underneath both.
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
        registry.register(PreparedSetRepository).useClass(PreparedSetRepository).asScoped();
        registry.register(PlaylistPositionRepository).useClass(PlaylistPositionRepository).asScoped();
        registry.register(ScheduleService).useClass(ScheduleService).asScoped();
        registry.register(LiveArmRepository).useClass(LiveArmRepository).asScoped();
        // Scoped, though it reaches the live input through playout, which registers after this module:
        // it is resolved inside the tick's run, long after boot. See `modules.ts`.
        registry.register(LiveBookings).useClass(LiveBookings).asScoped();
        // A SINGLETON, unlike everything else here, and that is the point of it: the tick is rebuilt
        // on every run, so the mark saying "I have already reported this" has to outlive it.
        registry.register(ScheduleNotices).useClass(ScheduleNotices).asSingleton();
        // The same, for when the tick started holding a changeover for its opening.
        registry.register(OpeningWait).useClass(OpeningWait).asSingleton();
        // And for what booking a live show has already said, apart from the changeover's own.
        registry.register(LiveNotices).useClass(LiveNotices).asSingleton();
        // `ScheduleTickJob` is deliberately NOT registered here. `JobsModule` walks `JobMappings` and
        // registers every job class itself, so a second registration is not redundancy, it throws at
        // boot: "Registration for ScheduleTickJob already exists".
    },
};
