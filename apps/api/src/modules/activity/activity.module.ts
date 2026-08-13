import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { ActivityRecorder } from './activity.recorder.js';
import { StationEventsRepository } from './station.events.repository.js';

/**
 * What the station has been doing, as one time-ordered list.
 *
 * The console's activity feed. It reads three sources — `segment_events` for a break's journey,
 * `play_history` for what aired, and `station_events` for everything that happens to the station as
 * a whole — and it owns only the third. The other two are written where they belong and are read
 * here without being copied, because a fact with two writers is two things that can disagree.
 *
 * ## Where it sits, and why that is safe
 *
 * Registered after `DirectorModule`, which is the last module that produces events, and before
 * `EnrichmentModule`. The position matters less here than anywhere else in `modules.ts`: this module
 * starts nothing, owns no loop, and nothing resolves it during another module's `start()` or
 * `ready()`. Its writers are request-path services and timer loops, by which point every module is
 * registered, so the modules that produce events may sit above it without a cycle.
 *
 * ## What it deliberately does not carry
 *
 * Plugin call logs. "What a plugin was asked and what it answered" is already `PluginLog`, behind
 * `GET /plugins/{id}/logs` on a `platform.manage` floor precisely because plugin output is whatever
 * a plugin chose to write and a careless one can put a token in a line. Folding that into a feed a
 * `platform.view` reader can see would quietly undo that decision.
 */
export const ActivityModule: ServerKitModule = {
    name: 'Activity',
    setup: async (registry: Registry) => {
        // Scoped, like every other repository.
        registry.register(StationEventsRepository).useClass(StationEventsRepository).asScoped();

        // Singleton, because its callers are: the transport's silence edge, the director's air
        // toggle, and the starve route. It holds no state of its own and opens a scope per write.
        registry.register(ActivityRecorder).useClass(ActivityRecorder).asSingleton();
    },
};
