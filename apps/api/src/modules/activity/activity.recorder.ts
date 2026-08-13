import { Container, Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { StationEventsRepository, type StationEvent } from './station.events.repository.js';

/**
 * The write side of the activity feed.
 *
 * One call, from anywhere, for anything that happens to the station as a whole. Two rules, both
 * load-bearing enough that breaking either turns the feed into something nobody reads.
 *
 * ## Best-effort, and it never throws
 *
 * Nothing reads a `station_events` row to decide anything, so the worst a lost row can do is leave a
 * gap in a feed on a station that is otherwise fine. The cost of the alternative is not symmetric: a
 * failed insert propagating out of {@link record} would cost the station the very thing the event
 * was describing — the silence poll, the air toggle, the recovery. So every failure is caught and
 * logged and the caller is answered as though it worked. This is the same trade `SegmentRepository`
 * documents for `segment_events`.
 *
 * Callers may therefore `void` the promise, and mostly do: an event is a note about something that
 * already happened, and nothing downstream is waiting for it to land.
 *
 * ## Edges only, never polls
 *
 * The console polls the transport twice a second. A row per reading would be a log file with a
 * primary key, a retention sweep that could not keep up, and a feed in which nothing stands out.
 * Every producer here has to speak only when something CHANGED — `PlayoutService.announceSilence`
 * already did exactly that for its log line, and the recorder rides that same edge rather than
 * adding a second opinion about when a thing is worth saying.
 *
 * ## Why it opens its own scope
 *
 * This is a singleton and repositories are scoped, so there is no ambient request to borrow a
 * connection from — the same position `DirectorService.inScope` is in, and the same answer. It is
 * also the right answer where there IS a request: an event is a fact about a moment that has already
 * passed, so it should not join a caller's transaction and disappear if that transaction rolls back.
 */
@Injectable()
export class ActivityRecorder {
    constructor(
        // The ROOT container. InjectKit resolves a singleton's dependencies from the root rather
        // than from whichever scope built it, which is what keeps the scope opened below from being
        // the child of a request scope that has already been disposed. Same reasoning as
        // `DirectorService`, in more detail there.
        private readonly container: Container,
        private readonly logger: Logger,
    ) {}

    /** Write one down. Resolves whether or not it landed; see the class note. */
    async record(event: StationEvent): Promise<void> {
        const scope = this.container.createScopedContainer();
        try {
            await scope.get(StationEventsRepository).append(event);
        } catch (error) {
            this.logger.warn(`activity: could not record ${event.module}/${event.kind} (${message(error)})`);
        } finally {
            await scope.disposeAsync();
        }
    }
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
